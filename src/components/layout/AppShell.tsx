import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  LayoutDashboard,
  ShoppingCart,
  PackagePlus,
  Receipt,
  Tag,
  Search,
  BarChart3,
  FolderKanban,
  DatabaseBackup,
  Users,
  Sun,
  Moon,
  LogOut,
  Menu,
  X,
  ChevronRight,
  Wifi,
  WifiOff,
  RefreshCw,
  FileText,
  Package,
  Keyboard,
} from 'lucide-react';
import { LOGO_DATA_URI, MENUS, STORE_NAME } from '../../constants/branding';
import type { GlobalTransactionSearchItem, PageId, Product, Session } from '../../types/pos';
import { fmtDate, rp } from '../../utils/format';
import {
  fuzzyMatchFields,
  splitHighlightedSegments,
  type TextRange,
} from '../../utils/fuzzySearch';

interface AppShellProps {
  session: Session;
  activePage: PageId;
  canAccess: (page: PageId) => boolean;
  products: Product[];
  transactions: GlobalTransactionSearchItem[];
  salesCartCount: number;
  dark: boolean;
  offline: boolean;
  checkingConnection?: boolean;
  onCheckConnection?: () => void;
  onToggleTheme: () => void;
  onNavigate: (page: PageId) => void;
  onSelectGlobalProduct: (product: Product) => void;
  onSelectGlobalTransaction: (tx: GlobalTransactionSearchItem) => void;
  onOpenHelp: () => void;
  onLogout: () => void;
  children: ReactNode;
}

const MENU_ICON: Record<PageId, typeof LayoutDashboard> = {
  dashboard: LayoutDashboard,
  sales: ShoppingCart,
  purchase: PackagePlus,
  expense: Receipt,
  product: Tag,
  search: Search,
  report: BarChart3,
  master: FolderKanban,
  utility: DatabaseBackup,
  account: Users,
};

type SearchScope = 'all' | 'product' | 'transaction';

interface ProductHit {
  kind: 'product';
  product: Product;
  score: number;
  nameRanges: TextRange[];
  codeRanges: TextRange[];
  catRanges: TextRange[];
}

interface TransactionHit {
  kind: 'transaction';
  tx: GlobalTransactionSearchItem;
  score: number;
  noRanges: TextRange[];
  partyRanges: TextRange[];
  dateRanges: TextRange[];
  noteRanges: TextRange[];
}

type GlobalHit = ProductHit | TransactionHit;

function HighlightText({ text, ranges }: { text: string; ranges?: TextRange[] }) {
  if (!text) return null;
  if (!ranges || ranges.length === 0) return <>{text}</>;
  const segments = splitHighlightedSegments(text, ranges);
  return (
    <>
      {segments.map((seg, i) =>
        seg.match ? (
          <mark
            key={i}
            className="bg-red-100 dark:bg-red-900/65 text-red-700 dark:text-red-200 rounded-[3px] px-0.5 font-extrabold"
          >
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  );
}

export function AppShell({
  session,
  activePage,
  canAccess,
  products,
  transactions,
  salesCartCount,
  dark,
  offline,
  checkingConnection = false,
  onCheckConnection,
  onToggleTheme,
  onNavigate,
  onSelectGlobalProduct,
  onSelectGlobalTransaction,
  onOpenHelp,
  onLogout,
  children,
}: AppShellProps) {
  const [searchText, setSearchText] = useState('');
  const [searchScope, setSearchScope] = useState<SearchScope>('all');
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeResultIdx, setActiveResultIdx] = useState(-1);

  const desktopSearchRef = useRef<HTMLInputElement | null>(null);
  const mobileSearchRef = useRef<HTMLInputElement | null>(null);
  const searchWrapRef = useRef<HTMLDivElement | null>(null);

  const visibleMenus = MENUS.filter((m) => canAccess(m.id));
  const currentMenu = MENUS.find((m) => m.id === activePage) || MENUS[0];

  const { productHits, transactionHits, combinedHits } = useMemo(() => {
    const q = searchText.trim();
    if (!q) {
      return {
        productHits: [] as ProductHit[],
        transactionHits: [] as TransactionHit[],
        combinedHits: [] as GlobalHit[],
      };
    }

    const pHits: ProductHit[] = [];
    for (const p of products) {
      const catTipe = [p.kategori, p.tipe].filter(Boolean).join(' · ');
      const match = fuzzyMatchFields(q, [
        { text: p.nama, weight: 1.5 },
        { text: p.kode, weight: 1.4 },
        { text: catTipe, weight: 0.9 },
      ]);
      if (match) {
        pHits.push({
          kind: 'product',
          product: p,
          score: match.score,
          nameRanges: match.fieldRanges[0],
          codeRanges: match.fieldRanges[1],
          catRanges: match.fieldRanges[2],
        });
      }
    }
    pHits.sort((a, b) => b.score - a.score);

    const tHits: TransactionHit[] = [];
    for (const tx of transactions) {
      const formattedDate = fmtDate(tx.tgl);
      const detail = [tx.no_bukti, tx.keterangan, tx.kasir].filter(Boolean).join(' · ');
      const match = fuzzyMatchFields(q, [
        { text: tx.no, weight: 1.6 },
        { text: tx.pihak, weight: 1.3 },
        { text: `${formattedDate} ${tx.tgl}`, weight: 0.9 },
        { text: detail, weight: 0.85 },
      ]);
      if (match) {
        tHits.push({
          kind: 'transaction',
          tx,
          score: match.score,
          noRanges: match.fieldRanges[0],
          partyRanges: match.fieldRanges[1],
          dateRanges: match.fieldRanges[2].filter(([, end]) => end <= formattedDate.length),
          noteRanges: match.fieldRanges[3],
        });
      }
    }
    tHits.sort((a, b) => b.score - a.score);

    const limitedProducts =
      searchScope === 'transaction' ? [] : pHits.slice(0, searchScope === 'product' ? 12 : 6);
    const limitedTxs =
      searchScope === 'product' ? [] : tHits.slice(0, searchScope === 'transaction' ? 12 : 6);

    const combined: GlobalHit[] = [...limitedProducts, ...limitedTxs];

    return {
      productHits: pHits,
      transactionHits: tHits,
      combinedHits: combined,
    };
  }, [searchText, products, transactions, searchScope]);

  useEffect(() => {
    setActiveResultIdx(-1);
  }, [searchText, searchScope]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchWrapRef.current && !searchWrapRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMobileSearchOpen(false);
        setMobileMenuOpen(false);
        setSearchOpen(false);
        return;
      }
      const isCtrlK = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k';
      const isSlash =
        e.key === '/' &&
        !/INPUT|TEXTAREA|SELECT/.test((document.activeElement as HTMLElement)?.tagName || '');

      if (isCtrlK || isSlash) {
        e.preventDefault();
        if (window.innerWidth >= 768) {
          desktopSearchRef.current?.focus();
          desktopSearchRef.current?.select();
          setSearchOpen(true);
        } else {
          setMobileSearchOpen(true);
        }
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  useEffect(() => {
    if (mobileSearchOpen) {
      setTimeout(() => mobileSearchRef.current?.focus(), 60);
    }
  }, [mobileSearchOpen]);

  const handlePickProduct = (product: Product) => {
    setSearchOpen(false);
    setMobileSearchOpen(false);
    setSearchText('');
    onSelectGlobalProduct(product);
  };

  const handlePickTransaction = (tx: GlobalTransactionSearchItem) => {
    setSearchOpen(false);
    setMobileSearchOpen(false);
    setSearchText('');
    onSelectGlobalTransaction(tx);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setSearchOpen(false);
      setMobileSearchOpen(false);
      desktopSearchRef.current?.blur();
      return;
    }
    if (combinedHits.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSearchOpen(true);
      setActiveResultIdx((i) => (i + 1) % combinedHits.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSearchOpen(true);
      setActiveResultIdx((i) => (i <= 0 ? combinedHits.length - 1 : i - 1));
    } else if (e.key === 'Enter' && activeResultIdx >= 0 && combinedHits[activeResultIdx]) {
      e.preventDefault();
      const chosen = combinedHits[activeResultIdx];
      if (chosen.kind === 'product') handlePickProduct(chosen.product);
      else handlePickTransaction(chosen.tx);
    }
  };

  const bottomTabs: { id: PageId | 'more'; label: string; icon: typeof LayoutDashboard }[] = [
    { id: 'dashboard', label: 'Beranda', icon: LayoutDashboard },
    ...(canAccess('sales') ? [{ id: 'sales' as const, label: 'Jual', icon: ShoppingCart }] : []),
    ...(canAccess('search') ? [{ id: 'search' as const, label: 'Cek Harga', icon: Search }] : []),
    ...(canAccess('report') ? [{ id: 'report' as const, label: 'Laporan', icon: BarChart3 }] : []),
    { id: 'more', label: 'Menu', icon: Menu },
  ];

  const stockLabel = (p: Product) => {
    if (p.jasa) return 'Jasa';
    if (p.stok <= 0) return 'Stok Kosong (0)';
    return `Stok ${p.stok}`;
  };

  const renderProductHit = (hit: ProductHit, flatIdx: number, compact = false) => {
    const p = hit.product;
    const isEmpty = !p.jasa && p.stok <= 0;
    const isSelected = flatIdx === activeResultIdx;
    const catTipe = [p.kategori, p.tipe].filter(Boolean).join(' · ') || '-';
    return (
      <button
        key={`prod-${p.kode}`}
        type="button"
        onMouseEnter={() => setActiveResultIdx(flatIdx)}
        onClick={() => handlePickProduct(p)}
        className={`w-full flex items-center justify-between gap-3 text-left transition-colors ${
          compact ? 'py-2.5 px-2.5 rounded-xl' : 'px-4 py-2.5'
        } ${
          isSelected
            ? 'bg-red-50/90 dark:bg-red-950/40'
            : isEmpty
              ? 'bg-rose-50/75 dark:bg-rose-950/25 hover:bg-rose-100/80 dark:hover:bg-rose-950/45'
              : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/70'
        }`}
      >
        <div className="min-w-0 flex-1">
          <div
            className={`text-sm font-semibold leading-snug break-words [overflow-wrap:anywhere] ${
              isEmpty ? 'text-rose-700 dark:text-rose-300' : 'text-zinc-900 dark:text-white'
            }`}
          >
            <HighlightText text={p.nama} ranges={hit.nameRanges} />
          </div>
          <div
            className={`text-xs mt-0.5 break-words [overflow-wrap:anywhere] ${
              isEmpty
                ? 'text-rose-600 dark:text-rose-400 font-medium'
                : 'text-zinc-500 dark:text-zinc-400'
            }`}
          >
            <span className="font-data">
              <HighlightText text={p.kode} ranges={hit.codeRanges} />
            </span>
            <span aria-hidden="true"> · </span>
            <HighlightText text={catTipe} ranges={hit.catRanges} />
            {compact && (
              <>
                <span aria-hidden="true"> · </span>
                <span>{stockLabel(p)}</span>
              </>
            )}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-sm font-bold font-data text-red-600 dark:text-red-400 whitespace-nowrap">
            {rp(p.harga)}
          </div>
          {!compact && (
            <div
              className={`text-[11px] font-semibold whitespace-nowrap ${
                isEmpty ? 'text-rose-600 dark:text-rose-400' : 'text-zinc-500 dark:text-zinc-400'
              }`}
            >
              {stockLabel(p)}
            </div>
          )}
        </div>
      </button>
    );
  };

  const renderTransactionHit = (hit: TransactionHit, flatIdx: number, compact = false) => {
    const tx = hit.tx;
    const isSelected = flatIdx === activeResultIdx;
    const formattedDate = fmtDate(tx.tgl);
    const detailText = [tx.no_bukti, tx.keterangan, tx.kasir].filter(Boolean).join(' · ');
    const kindLabel = tx.kind === 'sales' ? 'Penjualan' : 'Pembelian';

    return (
      <button
        key={`tx-${tx.kind}-${tx.no}`}
        type="button"
        onMouseEnter={() => setActiveResultIdx(flatIdx)}
        onClick={() => handlePickTransaction(tx)}
        className={`w-full flex items-center justify-between gap-3 text-left transition-colors ${
          compact ? 'py-2.5 px-2.5 rounded-xl' : 'px-4 py-2.5'
        } ${
          isSelected
            ? 'bg-red-50/90 dark:bg-red-950/40'
            : tx.batal
              ? 'bg-rose-50/60 dark:bg-rose-950/20 hover:bg-rose-100/70 dark:hover:bg-rose-950/40'
              : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/70'
        }`}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap text-sm font-semibold leading-snug text-zinc-900 dark:text-white">
            <span className="font-data">
              <HighlightText text={tx.no} ranges={hit.noRanges} />
            </span>
            <span aria-hidden="true" className="text-zinc-400">
              ·
            </span>
            <span className="break-words [overflow-wrap:anywhere]">
              <HighlightText text={tx.pihak} ranges={hit.partyRanges} />
            </span>
          </div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 break-words [overflow-wrap:anywhere]">
            <span
              className={
                tx.kind === 'sales'
                  ? 'font-semibold text-zinc-700 dark:text-zinc-300'
                  : 'font-semibold text-amber-700 dark:text-amber-300'
              }
            >
              {kindLabel}
            </span>
            <span aria-hidden="true"> · </span>
            <span className="font-data">
              <HighlightText text={formattedDate} ranges={hit.dateRanges} />
            </span>
            {detailText && (
              <>
                <span aria-hidden="true"> · </span>
                <HighlightText text={detailText} ranges={hit.noteRanges} />
              </>
            )}
            {tx.batal && (
              <>
                <span aria-hidden="true"> · </span>
                <span className="font-semibold text-rose-600 dark:text-rose-400">Batal</span>
              </>
            )}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div
            className={`text-sm font-bold font-data whitespace-nowrap ${
              tx.batal
                ? 'line-through text-zinc-400 dark:text-zinc-500'
                : 'text-zinc-900 dark:text-white'
            }`}
          >
            {rp(tx.total)}
          </div>
        </div>
      </button>
    );
  };

  const renderSearchResultsPanel = (compact = false) => {
    const visibleProducts = combinedHits.filter((h): h is ProductHit => h.kind === 'product');
    const visibleTxs = combinedHits.filter((h): h is TransactionHit => h.kind === 'transaction');
    let cursorIdx = 0;

    return (
      <>
        <div className="px-3 py-2 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between gap-2 bg-zinc-50/70 dark:bg-zinc-900/80">
          <div className="inline-flex items-center gap-1 p-0.5 rounded-lg bg-zinc-200/70 dark:bg-zinc-800">
            {(
              [
                ['all', `Semua (${productHits.length + transactionHits.length})`],
                ['product', `Barang (${productHits.length})`],
                ['transaction', `Nota (${transactionHits.length})`],
              ] as [SearchScope, string][]
            ).map(([scope, label]) => (
              <button
                key={scope}
                type="button"
                onClick={() => setSearchScope(scope)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-semibold whitespace-nowrap transition-colors ${
                  searchScope === scope
                    ? 'bg-white dark:bg-zinc-900 text-red-600 dark:text-red-400 shadow-sm'
                    : 'text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {!compact && canAccess('search') && (
            <button
              type="button"
              onClick={() => {
                setSearchOpen(false);
                onNavigate('search');
              }}
              className="text-[11px] font-semibold text-red-600 dark:text-red-400 hover:underline whitespace-nowrap"
            >
              Cek Harga (F5)
            </button>
          )}
        </div>

        {combinedHits.length === 0 ? (
          <div className="p-5 text-sm text-zinc-500 dark:text-zinc-400 text-center">
            Tidak ada barang atau nota yang cocok dengan "{searchText.trim()}"
          </div>
        ) : (
          <div className={`${compact ? 'max-h-[60vh]' : 'max-h-[420px]'} overflow-y-auto`}>
            {visibleProducts.length > 0 && (
              <div>
                <div className="px-4 py-1.5 text-[11px] font-bold text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800/40 border-b border-zinc-100 dark:border-zinc-800 flex items-center gap-1.5">
                  <Package className="w-3.5 h-3.5" />
                  <span>Produk ({productHits.length})</span>
                </div>
                <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {visibleProducts.map((hit) => renderProductHit(hit, cursorIdx++, compact))}
                </div>
              </div>
            )}

            {visibleTxs.length > 0 && (
              <div>
                <div className="px-4 py-1.5 text-[11px] font-bold text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800/40 border-y border-zinc-100 dark:border-zinc-800 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5" />
                  <span>Nota Transaksi ({transactionHits.length})</span>
                </div>
                <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {visibleTxs.map((hit) => renderTransactionHit(hit, cursorIdx++, compact))}
                </div>
              </div>
            )}
          </div>
        )}
      </>
    );
  };

  return (
    <div className="min-h-dvh flex bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-64 bg-zinc-950 text-zinc-200 flex-col border-r border-zinc-800/80 z-40">
        <div className="relative flex items-center gap-3 px-4 py-5 border-b border-zinc-800/80 overflow-hidden">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -left-4 -top-6 w-28 h-28 rounded-full bg-red-600/20 blur-xl"
          />
          <img
            src={LOGO_DATA_URI}
            alt={STORE_NAME}
            className="relative w-11 h-11 object-contain shrink-0"
          />
          <div className="relative min-w-0">
            <div className="font-extrabold text-white tracking-tight text-base truncate">
              SAHABAT
            </div>
            <div className="text-[11px] text-zinc-400 truncate">
              Accessories &amp; Service
            </div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          {visibleMenus.map((item) => {
            const Icon = MENU_ICON[item.id];
            const active = activePage === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className={`w-full min-h-[42px] px-3 rounded-xl flex items-center gap-3 text-sm font-medium transition-all whitespace-nowrap ${
                  active
                    ? 'bg-gradient-to-r from-red-600 to-rose-600 text-white font-semibold shadow-md shadow-red-600/20'
                    : 'text-zinc-400 hover:bg-zinc-900 hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="flex-1 text-left truncate">{item.label}</span>
                {item.id === 'sales' && salesCartCount > 0 && (
                  <span
                    className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold font-data ${
                      active ? 'bg-white text-red-700' : 'bg-red-600 text-white'
                    }`}
                  >
                    {salesCartCount}
                  </span>
                )}
                {item.shortcut && (
                  <span
                    className={`text-[10px] font-data px-1.5 py-0.5 rounded ${
                      active ? 'bg-white/15 text-white' : 'text-zinc-500'
                    }`}
                  >
                    {item.shortcut}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-3 border-t border-zinc-800/80 space-y-1">
          <button
            type="button"
            onClick={onOpenHelp}
            className="w-full min-h-[40px] px-3 rounded-xl flex items-center gap-3 text-xs font-medium text-zinc-400 hover:bg-zinc-900 hover:text-white transition-colors"
          >
            <Keyboard className="w-4 h-4 shrink-0" />
            <span className="flex-1 text-left">Pintasan Keyboard</span>
            <span className="text-[10px] font-data text-zinc-500">F10</span>
          </button>
          <button
            type="button"
            onClick={onToggleTheme}
            className="w-full min-h-[40px] px-3 rounded-xl flex items-center gap-3 text-xs font-medium text-zinc-400 hover:bg-zinc-900 hover:text-white transition-colors"
          >
            {dark ? <Sun className="w-4 h-4 shrink-0" /> : <Moon className="w-4 h-4 shrink-0" />}
            <span>{dark ? 'Mode Terang' : 'Mode Gelap'}</span>
          </button>
        </div>
      </aside>

      {/* Main Column */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
        {offline && (
          <div
            role="status"
            aria-live="assertive"
            className="bg-rose-600 text-white text-xs font-semibold px-4 py-1.5 flex items-center justify-center gap-3 flex-wrap"
          >
            <span className="flex items-center gap-1.5">
              <WifiOff className="w-3.5 h-3.5 shrink-0" />
              Koneksi terputus — beberapa fitur penyimpanan membutuhkan koneksi internet
            </span>
            {onCheckConnection && (
              <button
                type="button"
                onClick={onCheckConnection}
                disabled={checkingConnection}
                className="px-2.5 py-0.5 rounded-lg bg-white/20 hover:bg-white/30 text-white text-[11px] font-bold transition-colors disabled:opacity-60"
              >
                {checkingConnection ? 'Mengecek…' : 'Cek Ulang'}
              </button>
            )}
          </div>
        )}

        {/* Single-row sticky Top Bar */}
        <header className="sticky top-0 z-30 h-14 lg:h-16 bg-white/85 dark:bg-zinc-900/85 backdrop-blur-xl border-b border-zinc-200/80 dark:border-zinc-800 px-3 sm:px-4 lg:px-6 flex items-center justify-between gap-2 sm:gap-4 pt-safe">
          <div className="flex items-center gap-2.5 min-w-0 shrink-0">
            <img
              src={LOGO_DATA_URI}
              alt={STORE_NAME}
              className="w-8 h-8 object-contain lg:hidden shrink-0"
            />
            <h1 className="text-base lg:text-lg font-extrabold tracking-tight text-zinc-900 dark:text-white truncate max-w-[120px] sm:max-w-none">
              {currentMenu.label}
            </h1>
          </div>

          {/* Persistent Global Fuzzy Search Bar (Tablet & Desktop md+) */}
          <div ref={searchWrapRef} className="hidden md:block relative flex-1 max-w-md lg:max-w-lg">
            <div className="relative">
              <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                ref={desktopSearchRef}
                type="text"
                value={searchText}
                onFocus={() => setSearchOpen(true)}
                onChange={(e) => {
                  setSearchText(e.target.value);
                  setSearchOpen(true);
                }}
                onKeyDown={handleInputKeyDown}
                placeholder="Cari barang atau nota… (/ atau Ctrl+K)"
                aria-label="Pencarian global barang dan nota transaksi"
                className={`w-full min-h-[40px] pl-10 ${searchText ? 'pr-9' : 'pr-4'} rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-100/70 dark:bg-zinc-800/80 text-sm focus:outline-none focus:ring-2 focus:ring-red-600 focus:bg-white dark:focus:bg-zinc-900 transition-all`}
              />
              {searchText && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchText('');
                    desktopSearchRef.current?.focus();
                  }}
                  aria-label="Hapus pencarian"
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200/70 dark:hover:bg-zinc-700 flex items-center justify-center"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {searchOpen && searchText.trim() && (
              <div className="absolute left-0 right-0 top-12 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 shadow-2xl overflow-hidden z-50">
                {renderSearchResultsPanel(false)}
              </div>
            )}
          </div>

          {/* Right Actions */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {/* Compact Persistent Mobile Search Trigger */}
            <button
              type="button"
              onClick={() => setMobileSearchOpen(true)}
              aria-label="Cari barang atau nota"
              className="md:hidden min-h-[38px] px-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-100/80 dark:bg-zinc-800/80 text-zinc-500 dark:text-zinc-300 text-xs font-medium flex items-center gap-1.5 hover:bg-zinc-200/60 dark:hover:bg-zinc-800 transition-colors"
            >
              <Search className="w-3.5 h-3.5 shrink-0 text-zinc-500 dark:text-zinc-400" />
              <span className="max-w-[54px] truncate">{searchText.trim() || 'Cari…'}</span>
            </button>

            <button
              type="button"
              onClick={onCheckConnection}
              disabled={checkingConnection}
              aria-live="polite"
              aria-label={
                checkingConnection
                  ? 'Memeriksa status koneksi'
                  : offline
                    ? 'Status koneksi: Offline. Klik untuk coba hubungkan ulang.'
                    : 'Status koneksi: Online. Klik untuk memeriksa koneksi.'
              }
              title={
                offline
                  ? 'Offline — tidak terhubung ke server. Klik untuk cek ulang.'
                  : 'Online — terhubung ke server. Klik untuk cek ulang.'
              }
              className={`min-h-[38px] sm:min-h-[40px] px-2.5 sm:px-3 rounded-xl border text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 ${
                checkingConnection
                  ? 'border-amber-200 dark:border-amber-800/80 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300'
                  : offline
                    ? 'border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-950/70'
                    : 'border-emerald-200/90 dark:border-emerald-800/70 bg-emerald-50/80 dark:bg-emerald-950/35 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100/80 dark:hover:bg-emerald-950/55'
              }`}
            >
              {checkingConnection ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" />
              ) : offline ? (
                <WifiOff className="w-3.5 h-3.5 shrink-0" />
              ) : (
                <>
                  <span
                    className="w-2 h-2 rounded-full bg-emerald-500 shrink-0"
                    aria-hidden="true"
                  />
                  <Wifi className="w-3.5 h-3.5 shrink-0 hidden sm:block" />
                </>
              )}
              <span>{checkingConnection ? 'Mengecek…' : offline ? 'Offline' : 'Online'}</span>
            </button>

            <button
              type="button"
              onClick={onOpenHelp}
              aria-label="Panduan pintasan keyboard (F10)"
              title="Pintasan Keyboard (F10)"
              className="hidden sm:flex min-h-[40px] min-w-[40px] items-center justify-center rounded-xl text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <Keyboard className="w-5 h-5" />
            </button>

            <button
              type="button"
              onClick={onToggleTheme}
              aria-label="Ganti tema"
              title={dark ? 'Mode Terang' : 'Mode Gelap'}
              className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              {dark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>

            <div className="hidden sm:flex items-center gap-3 pl-2 border-l border-zinc-200 dark:border-zinc-800">
              <div className="text-right leading-tight">
                <div className="text-sm font-bold text-zinc-900 dark:text-white whitespace-nowrap">
                  {session.user}
                </div>
                <div className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
                  {session.role === 'owner' ? 'Owner' : 'Admin'}
                </div>
              </div>
              <button
                type="button"
                onClick={onLogout}
                className="min-h-[40px] px-3.5 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:border-red-300 dark:hover:border-red-800 text-xs font-semibold text-zinc-700 dark:text-zinc-200 flex items-center gap-1.5 whitespace-nowrap transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" /> Keluar
              </button>
            </div>
          </div>
        </header>

        {/* Mobile Global Fuzzy Search Overlay */}
        {mobileSearchOpen && (
          <div className="md:hidden fixed inset-0 z-50 bg-zinc-950/60 backdrop-blur-[2px] flex flex-col">
            <div className="bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 p-3 pt-safe">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    ref={mobileSearchRef}
                    type="text"
                    value={searchText}
                    onChange={(e) => setSearchText(e.target.value)}
                    onKeyDown={handleInputKeyDown}
                    placeholder="Cari barang, no nota, konsumen..."
                    className={`w-full min-h-[44px] pl-10 ${searchText ? 'pr-9' : 'pr-3'} rounded-xl border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-red-600`}
                  />
                  {searchText && (
                    <button
                      type="button"
                      onClick={() => {
                        setSearchText('');
                        mobileSearchRef.current?.focus();
                      }}
                      aria-label="Hapus pencarian"
                      className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 flex items-center justify-center"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setMobileSearchOpen(false)}
                  aria-label="Tutup pencarian"
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-zinc-600 dark:text-zinc-300"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              {searchText.trim() && (
                <div className="mt-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
                  {renderSearchResultsPanel(true)}
                </div>
              )}
            </div>
            <div className="flex-1" onClick={() => setMobileSearchOpen(false)} />
          </div>
        )}

        {/* Main Viewport Content */}
        <main className="flex-1 p-4 md:p-5 lg:p-6 pb-24 lg:pb-8 max-w-[1400px] w-full mx-auto">
          {children}
        </main>

        <footer className="hidden lg:flex items-center justify-between px-6 py-4 border-t border-zinc-200/80 dark:border-zinc-800 text-xs text-zinc-500 dark:text-zinc-400">
          <span>{STORE_NAME}</span>
          <span>Hak akses: {session.role === 'owner' ? 'Owner' : 'Admin'}</span>
        </footer>
      </div>

      {/* Mobile & Tablet Bottom Tab Bar */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-xl border-t border-zinc-200/80 dark:border-zinc-800 pb-safe">
        <div className="flex items-center justify-around h-14">
          {bottomTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive =
              tab.id === 'more' ? mobileMenuOpen : activePage === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  if (tab.id === 'more') {
                    setMobileMenuOpen(true);
                  } else {
                    setMobileMenuOpen(false);
                    onNavigate(tab.id);
                  }
                }}
                className={`relative flex-1 h-full flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold transition-colors ${
                  isActive
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-zinc-500 dark:text-zinc-400'
                }`}
              >
                {isActive && (
                  <span className="absolute top-0 inset-x-4 h-0.5 rounded-b-full bg-red-600 dark:bg-red-500" />
                )}
                <div className="relative">
                  <Icon className="w-5 h-5" />
                  {tab.id === 'sales' && salesCartCount > 0 && (
                    <span className="absolute -top-1.5 -right-2.5 min-w-[16px] h-4 px-1 rounded-full bg-red-600 text-white text-[9px] font-bold flex items-center justify-center font-data">
                      {salesCartCount}
                    </span>
                  )}
                </div>
                <span className="truncate">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Mobile & Tablet Bottom Sheet Drawer ("Menu") */}
      {mobileMenuOpen && (
        <div
          className="lg:hidden fixed inset-0 z-50 bg-zinc-950/60 backdrop-blur-[2px] flex items-end justify-center"
          onClick={(e) => {
            if (e.target === e.currentTarget) setMobileMenuOpen(false);
          }}
        >
          <div className="w-full max-w-2xl max-h-[82dvh] rounded-t-3xl bg-white dark:bg-zinc-900 border-t border-zinc-200 dark:border-zinc-800 overflow-y-auto pb-safe">
            <div className="w-10 h-1.5 rounded-full bg-zinc-300 dark:bg-zinc-700 mx-auto my-3" />
            <div className="px-5 pb-3 flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800">
              <div className="flex items-center gap-3 min-w-0">
                <img src={LOGO_DATA_URI} alt="" className="w-9 h-9 object-contain shrink-0" />
                <div className="min-w-0">
                  <div className="font-bold text-zinc-900 dark:text-white truncate">{session.user}</div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                    {session.role === 'owner' ? 'Owner' : 'Admin'}
                    {session.email ? ` · ${session.email}` : ''}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-zinc-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 grid grid-cols-2 gap-2">
              {visibleMenus.map((item) => {
                const Icon = MENU_ICON[item.id];
                const active = activePage === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setMobileMenuOpen(false);
                      onNavigate(item.id);
                    }}
                    className={`min-h-[48px] px-3.5 rounded-xl border flex items-center gap-2.5 text-sm font-semibold text-left transition-colors ${
                      active
                        ? 'bg-red-50 dark:bg-red-950/50 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400'
                        : 'border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="px-3 pb-4 pt-1 space-y-2 border-t border-zinc-100 dark:border-zinc-800 mt-1">
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  onLogout();
                }}
                className="w-full min-h-[46px] px-4 rounded-xl flex items-center justify-between text-sm font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30"
              >
                <span className="flex items-center gap-3">
                  <LogOut className="w-4 h-4" /> Keluar dari Aplikasi
                </span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
