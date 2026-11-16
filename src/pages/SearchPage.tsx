import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Copy, Eye, RefreshCw, Search, X } from 'lucide-react';
import { PRICE_MODE_LABEL } from '../constants/branding';
import type { PriceMode, Product } from '../types/pos';
import { copyToClipboard, norm, priceModeNote, priceOf, rp } from '../utils/format';
import { BarcodeModal } from '../components/ui/BarcodeModal';
import { Modal } from '../components/ui/Dialog';
import { StockStatusText } from '../components/ui/ProductDetailModal';

interface SearchPageProps {
  products: Product[];
  initialStockFilter: '' | 'low' | 'out';
  onClearInitialFilter: () => void;
  onReload: () => Promise<Product[] | void>;
  onSelectProduct: (product: Product) => void;
  onToast: (msg: string, type?: 'ok' | 'warn' | 'err' | 'info') => void;
}

export function SearchPage({
  products,
  initialStockFilter,
  onClearInitialFilter,
  onReload,
  onSelectProduct,
  onToast,
}: SearchPageProps) {
  const [priceMode, setPriceMode] = useState<PriceMode>('umum');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [stockFilter, setStockFilter] = useState<'' | 'low' | 'out'>(initialStockFilter);
  const [limit, setLimit] = useState(60);
  const [selectedCodes, setSelectedCodes] = useState<Set<string>>(() => new Set());
  const [showScanner, setShowScanner] = useState(false);
  const [showCopyPreview, setShowCopyPreview] = useState(false);
  const [manualCopyText, setManualCopyText] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (window.innerWidth >= 1024) {
      searchInputRef.current?.focus();
    }
  }, []);

  useEffect(() => {
    if (initialStockFilter) {
      setStockFilter(initialStockFilter);
      onClearInitialFilter();
    }
  }, [initialStockFilter, onClearInitialFilter]);

  const categories = useMemo(
    () => [...new Set(products.map((p) => p.kategori).filter(Boolean))].sort(),
    [products],
  );

  const filtered = useMemo(() => {
    const words = norm(query).split(' ').filter(Boolean);
    return products.filter((p) => {
      if (category && p.kategori !== category) return false;
      if (stockFilter === 'low' && (p.jasa || p.stok > 3)) return false;
      if (stockFilter === 'out' && (p.jasa || p.stok > 0)) return false;
      if (!words.length) return true;
      const hay = norm(`${p.kode} ${p.nama} ${p.kategori} ${p.tipe || ''}`);
      return words.every((w) => hay.includes(w));
    });
  }, [products, query, category, stockFilter]);

  const visibleRows = filtered.slice(0, limit);
  const allVisibleSelected =
    visibleRows.length > 0 && visibleRows.every((p) => selectedCodes.has(p.kode));

  const toggleCode = (kode: string) => {
    setSelectedCodes((prev) => {
      const next = new Set(prev);
      if (next.has(kode)) next.delete(kode);
      else next.add(kode);
      return next;
    });
  };

  const toggleAllVisible = () => {
    setSelectedCodes((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        visibleRows.forEach((p) => next.delete(p.kode));
      } else {
        visibleRows.forEach((p) => next.add(p.kode));
      }
      return next;
    });
  };

  const selectedCopyItems = useMemo(
    () =>
      products
        .filter((p) => selectedCodes.has(p.kode))
        .map((p) => {
          const val = priceOf(p, priceMode);
          return {
            kode: p.kode,
            nama: p.nama,
            priceText: val > 0 ? rp(val) : '',
          };
        }),
    [products, selectedCodes, priceMode],
  );

  const formattedCopyText = useMemo(
    () =>
      selectedCopyItems
        .map((item) =>
          item.priceText
            ? `${item.nama} - *${item.priceText}*`
            : `${item.nama} - harga belum diisi`,
        )
        .join('\n'),
    [selectedCopyItems],
  );

  const handleCopySelected = async () => {
    if (!selectedCopyItems.length) return;
    const ok = await copyToClipboard(formattedCopyText);
    if (ok) {
      onToast(`${selectedCopyItems.length} barang disalin (${PRICE_MODE_LABEL[priceMode]})`, 'ok');
    } else {
      setManualCopyText(formattedCopyText);
    }
  };

  const handleReload = async () => {
    setReloading(true);
    try {
      await onReload();
    } finally {
      setReloading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 p-4 space-y-3 shadow-sm shadow-zinc-900/[0.03]">
        {/* Segmented Price Mode Control */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex p-1 rounded-xl bg-zinc-100 dark:bg-zinc-800 gap-1 w-full sm:w-auto">
            {(['umum', 'toko', 'pasang'] as PriceMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setPriceMode(mode)}
                className={`flex-1 sm:flex-none min-h-[38px] px-3 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                  priceMode === mode
                    ? 'bg-white dark:bg-zinc-900 text-red-600 dark:text-red-400 shadow-sm'
                    : 'text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white'
                }`}
              >
                {PRICE_MODE_LABEL[mode]}
              </button>
            ))}
          </div>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            {priceModeNote(priceMode)}
          </span>
        </div>

        {/* Search Input + Actions */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setLimit(60);
              }}
              placeholder="Ketik kode, nama, atau kategori barang..."
              className={`w-full min-h-[44px] pl-10 ${query ? 'pr-10' : 'pr-4'} rounded-xl border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-red-600 focus:border-transparent`}
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setLimit(60);
                  searchInputRef.current?.focus();
                }}
                aria-label="Hapus pencarian"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200/70 dark:hover:bg-zinc-700 flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => setShowScanner(true)}
            aria-label="Scan barcode"
            className="min-h-[44px] min-w-[44px] px-3 rounded-xl border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-center gap-1.5 text-sm font-semibold"
          >
            <Camera className="w-4 h-4 text-red-600 dark:text-red-400" />
            <span className="hidden sm:inline">Scan</span>
          </button>
          <button
            type="button"
            disabled={reloading}
            onClick={handleReload}
            aria-label="Muat ulang daftar barang"
            className="min-h-[44px] min-w-[44px] px-3 rounded-xl border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-center text-sm font-semibold"
          >
            <RefreshCw className={`w-4 h-4 ${reloading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Filter Chips */}
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
          <button
            type="button"
            onClick={() => {
              setCategory('');
              setStockFilter('');
              onClearInitialFilter();
              setLimit(60);
            }}
            className={`shrink-0 min-h-[36px] px-3.5 rounded-lg border text-xs font-semibold whitespace-nowrap transition-colors ${
              !category && !stockFilter
                ? 'bg-red-600 border-red-600 text-white shadow-sm shadow-red-600/20'
                : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800'
            }`}
          >
            Semua
          </button>
          <button
            type="button"
            onClick={() => {
              setCategory('');
              setStockFilter((s) => (s === 'low' ? '' : 'low'));
              onClearInitialFilter();
              setLimit(60);
            }}
            className={`shrink-0 min-h-[36px] px-3.5 rounded-lg border text-xs font-semibold whitespace-nowrap transition-colors ${
              stockFilter === 'low'
                ? 'bg-amber-600 border-amber-600 text-white'
                : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800'
            }`}
          >
            Stok Menipis
          </button>
          <button
            type="button"
            onClick={() => {
              setCategory('');
              setStockFilter((s) => (s === 'out' ? '' : 'out'));
              onClearInitialFilter();
              setLimit(60);
            }}
            className={`shrink-0 min-h-[36px] px-3.5 rounded-lg border text-xs font-semibold whitespace-nowrap transition-colors ${
              stockFilter === 'out'
                ? 'bg-rose-600 border-rose-600 text-white'
                : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800'
            }`}
          >
            Stok Habis
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => {
                setStockFilter('');
                setCategory((c) => (c === cat ? '' : cat));
                onClearInitialFilter();
                setLimit(60);
              }}
              className={`shrink-0 min-h-[36px] px-3.5 rounded-lg border text-xs font-semibold whitespace-nowrap transition-colors ${
                category === cat
                  ? 'bg-red-600 border-red-600 text-white shadow-sm shadow-red-600/20'
                  : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between px-1 text-xs text-zinc-500 dark:text-zinc-400">
        <span>{filtered.length} barang ditemukan</span>
        {visibleRows.length > 0 && (
          <button
            type="button"
            onClick={toggleAllVisible}
            className="font-semibold text-red-600 dark:text-red-400 hover:underline md:hidden"
          >
            {allVisibleSelected ? 'Batal pilih semua' : 'Pilih semua yang tampil'}
          </button>
        )}
      </div>

      {/* Results Card */}
      <div className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 overflow-hidden shadow-sm shadow-zinc-900/[0.03]">
        {visibleRows.length === 0 ? (
          <div className="p-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
            {products.length === 0
              ? 'Belum ada data barang. Tambahkan lewat menu Produk.'
              : 'Tidak ada barang yang cocok dengan filter.'}
          </div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800 text-left text-xs text-zinc-500 dark:text-zinc-400">
                    <th className="py-3 pl-4 pr-2 w-10">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={toggleAllVisible}
                        aria-label="Pilih semua yang tampil"
                        className="w-4 h-4 rounded accent-red-600 cursor-pointer"
                      />
                    </th>
                    <th className="py-3 px-3 font-semibold">Barang</th>
                    <th className="py-3 px-3 font-semibold">Kategori</th>
                    <th className="py-3 px-3 font-semibold text-right">
                      {PRICE_MODE_LABEL[priceMode]}
                    </th>
                    <th className="py-3 pl-3 pr-4 font-semibold text-right">Stok</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {visibleRows.map((p) => {
                    const price = priceOf(p, priceMode);
                    const checked = selectedCodes.has(p.kode);
                    const isEmpty = !p.jasa && p.stok <= 0;
                    return (
                      <tr
                        key={p.kode}
                        onClick={() => onSelectProduct(p)}
                        className={`cursor-pointer transition-colors ${
                          isEmpty
                            ? checked
                              ? 'bg-rose-100/90 dark:bg-rose-950/60 hover:bg-rose-100 dark:hover:bg-rose-950/70'
                              : 'bg-rose-50/90 dark:bg-rose-950/35 hover:bg-rose-100/80 dark:hover:bg-rose-950/50'
                            : checked
                              ? 'bg-red-50/75 dark:bg-red-950/25 hover:bg-red-100/60 dark:hover:bg-red-950/40'
                              : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                        }`}
                      >
                        <td
                          className="py-3 pl-4 pr-2"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleCode(p.kode);
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onClick={(e) => e.stopPropagation()}
                            onChange={() => toggleCode(p.kode)}
                            aria-label={`Pilih ${p.nama}`}
                            className="w-4 h-4 rounded accent-red-600 cursor-pointer"
                          />
                        </td>
                        <td className="py-3 px-3 max-w-md">
                          <div
                            className={`${checked ? 'font-normal' : 'font-semibold'} leading-snug break-words [overflow-wrap:anywhere] ${
                              isEmpty
                                ? 'text-rose-700 dark:text-rose-300'
                                : 'text-zinc-900 dark:text-white'
                            }`}
                          >
                            {p.nama}
                          </div>
                          <div className="text-xs font-data text-zinc-500 dark:text-zinc-400 mt-0.5 break-words [overflow-wrap:anywhere]">
                            {p.kode}
                            {p.tipe ? ` · ${p.tipe}` : ''}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-zinc-600 dark:text-zinc-300 whitespace-nowrap">
                          {p.kategori || '-'}
                        </td>
                        <td className="py-3 px-3 text-right font-data whitespace-nowrap">
                          {price > 0 ? (
                            <span
                              className={
                                checked
                                  ? 'inline-block px-2 py-0.5 rounded-md bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 font-extrabold whitespace-nowrap'
                                  : 'font-bold text-zinc-900 dark:text-white whitespace-nowrap'
                              }
                            >
                              {rp(price)}
                            </span>
                          ) : (
                            <span className="font-normal text-xs text-zinc-400">belum diisi</span>
                          )}
                        </td>
                        <td className="py-3 pl-3 pr-4 text-right whitespace-nowrap">
                          <StockStatusText product={p} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Card Rows */}
            <div className="md:hidden divide-y divide-zinc-100 dark:divide-zinc-800">
              {visibleRows.map((p) => {
                const price = priceOf(p, priceMode);
                const checked = selectedCodes.has(p.kode);
                const isEmpty = !p.jasa && p.stok <= 0;
                return (
                  <div
                    key={p.kode}
                    onClick={() => onSelectProduct(p)}
                    className={`p-3.5 flex items-start gap-2.5 transition-colors ${
                      isEmpty
                        ? checked
                          ? 'bg-rose-100/90 dark:bg-rose-950/60 active:bg-rose-100'
                          : 'bg-rose-50/90 dark:bg-rose-950/35 active:bg-rose-100 dark:active:bg-rose-950/50'
                        : checked
                          ? 'bg-red-50/75 dark:bg-red-950/25 active:bg-red-100/70'
                          : 'active:bg-zinc-50 dark:active:bg-zinc-800/60'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleCode(p.kode);
                      }}
                      aria-label={`Pilih ${p.nama}`}
                      className="min-w-[44px] min-h-[44px] -ml-1.5 -mt-0.5 flex items-center justify-center shrink-0"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        readOnly
                        className="w-5 h-5 rounded accent-red-600 pointer-events-none"
                      />
                    </button>

                    <div className="min-w-0 flex-1 pr-1">
                      <div
                        className={`${checked ? 'font-normal' : 'font-semibold'} text-sm leading-snug break-words [overflow-wrap:anywhere] ${
                          isEmpty
                            ? 'text-rose-700 dark:text-rose-300'
                            : 'text-zinc-900 dark:text-white'
                        }`}
                      >
                        {p.nama}
                      </div>
                      <div className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5 flex-wrap">
                        <span>{p.kategori || '-'}</span>
                        <span>·</span>
                        <StockStatusText product={p} />
                      </div>
                    </div>

                    <div className="text-right shrink-0 pl-1 pt-0.5">
                      <div
                        className={
                          checked && price > 0
                            ? 'inline-block px-2 py-0.5 rounded-md bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 font-data font-extrabold text-sm whitespace-nowrap'
                            : 'font-data font-bold text-sm text-red-600 dark:text-red-400 whitespace-nowrap'
                        }
                      >
                        {price > 0 ? rp(price) : '-'}
                      </div>
                      <div className="text-[11px] font-data text-zinc-400 mt-0.5 whitespace-nowrap">
                        {p.kode}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {filtered.length > limit && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => setLimit((l) => l + 60)}
            className="min-h-[44px] px-5 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm font-semibold hover:bg-zinc-50 dark:hover:bg-zinc-800"
          >
            Muat lebih banyak ({filtered.length - limit} tersisa)
          </button>
        </div>
      )}

      {/* Floating Selection Copy Bar */}
      {selectedCodes.size > 0 && <div className="h-16" aria-hidden="true" />}
      {selectedCodes.size > 0 && (
        <div className="fixed bottom-[calc(4rem+env(safe-area-inset-bottom,0px))] lg:bottom-6 left-1/2 -translate-x-1/2 z-30 w-[calc(100%-24px)] max-w-md rounded-2xl bg-zinc-950 dark:bg-zinc-800 text-white px-4 py-2.5 shadow-2xl border border-zinc-800 dark:border-zinc-700 flex items-center justify-between gap-2">
          <span className="text-xs sm:text-sm font-bold whitespace-nowrap">
            {selectedCodes.size} dipilih
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowCopyPreview(true)}
              aria-label="Pratinjau teks salinan"
              title="Lihat pratinjau format bold"
              className="min-h-[40px] min-w-[40px] px-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold flex items-center justify-center gap-1"
            >
              <Eye className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Pratinjau</span>
            </button>
            <button
              type="button"
              onClick={handleCopySelected}
              className="min-h-[40px] px-3.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shadow-sm"
            >
              <Copy className="w-3.5 h-3.5" />
              Salin {PRICE_MODE_LABEL[priceMode]}
            </button>
            <button
              type="button"
              onClick={() => setSelectedCodes(new Set())}
              className="min-h-[40px] min-w-[40px] rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 flex items-center justify-center"
              aria-label="Kosongkan pilihan"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {showCopyPreview && (
        <Modal
          title={`Daftar Harga (${PRICE_MODE_LABEL[priceMode]})`}
          onClose={() => setShowCopyPreview(false)}
          maxWidth="max-w-md"
        >
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-3">
            Harga otomatis dicetak <strong className="text-zinc-900 dark:text-white">bold</strong> sebagai pembeda dari nama barang (siap tempel ke WhatsApp/catatan).
          </p>
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/70 p-3.5 max-h-64 overflow-y-auto space-y-2 text-sm">
            {selectedCopyItems.map((item) => (
              <div
                key={item.kode}
                className="flex items-baseline justify-between gap-3 border-b border-dashed border-zinc-200 dark:border-zinc-700/80 last:border-0 pb-1.5 last:pb-0"
              >
                <span className="min-w-0 flex-1 font-normal text-zinc-700 dark:text-zinc-300 break-words [overflow-wrap:anywhere]">
                  {item.nama}
                </span>
                <span className="font-data shrink-0 whitespace-nowrap">
                  {item.priceText ? (
                    <strong className="font-extrabold text-zinc-950 dark:text-white">
                      {item.priceText}
                    </strong>
                  ) : (
                    <span className="text-xs text-zinc-400">harga belum diisi</span>
                  )}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowCopyPreview(false)}
              className="min-h-[42px] px-4 rounded-xl border border-zinc-300 dark:border-zinc-700 text-sm font-semibold"
            >
              Tutup
            </button>
            <button
              type="button"
              onClick={async () => {
                await handleCopySelected();
                setShowCopyPreview(false);
              }}
              className="min-h-[42px] px-4 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold flex items-center gap-1.5"
            >
              <Copy className="w-4 h-4" /> Salin Sekarang
            </button>
          </div>
        </Modal>
      )}

      {showScanner && (
        <BarcodeModal
          onDetected={(code) => {
            setShowScanner(false);
            setQuery(code);
            setCategory('');
            setStockFilter('');
          }}
          onClose={() => setShowScanner(false)}
        />
      )}

      {manualCopyText !== null && (
        <Modal
          title="Salin Daftar Harga"
          onClose={() => setManualCopyText(null)}
          maxWidth="max-w-md"
        >
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">
            Browser memblokir salin otomatis. Tekan dan pilih semua teks di bawah ini lalu salin:
          </p>
          <textarea
            readOnly
            rows={8}
            value={manualCopyText}
            onFocus={(e) => e.target.select()}
            className="w-full p-3 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-xs font-data"
          />
        </Modal>
      )}
    </div>
  );
}
