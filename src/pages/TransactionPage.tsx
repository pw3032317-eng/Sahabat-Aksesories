import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import {
  Camera,
  Minus,
  Plus,
  Printer,
  QrCode,
  RotateCcw,
  Search,
  Trash2,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { TIERS } from '../constants/branding';
import { callApi } from '../services/api';
import type {
  CartItem,
  MasterItem,
  PriceTier,
  Product,
  Session,
  TransactionNote,
  TransactionSummary,
} from '../types/pos';
import { createUid, fmtDate, isoDate, lineSubtotal, norm, rp } from '../utils/format';
import { BarcodeModal } from '../components/ui/BarcodeModal';
import { ConfirmModal } from '../components/ui/Dialog';
import { StockStatusText } from '../components/ui/ProductDetailModal';
import { QrisModal } from '../components/ui/QrisModal';

interface TransactionPageProps {
  kind: 'sales' | 'purchase';
  session: Session;
  products: Product[];
  refreshKey?: number;
  cart: CartItem[];
  onChangeCart: Dispatch<SetStateAction<CartItem[]>>;
  onRefreshProducts: () => Promise<Product[] | void>;
  onOpenNote: (note: TransactionNote) => void;
  onToast: (
    msg: string,
    type?: 'ok' | 'warn' | 'err' | 'info',
    actionLabel?: string,
    onAction?: () => void,
  ) => void;
}

function CartNumInput({
  value,
  min = 0,
  max,
  isInt = false,
  inputMode = 'decimal',
  className,
  onCommit,
}: {
  value: number;
  min?: number;
  max?: number;
  isInt?: boolean;
  inputMode?: 'numeric' | 'decimal';
  className: string;
  onCommit: (next: number) => boolean | void;
}) {
  const [draft, setDraft] = useState(String(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(String(value));
  }, [value, focused]);

  return (
    <input
      type="number"
      min={min}
      max={max}
      inputMode={inputMode}
      value={focused ? draft : value}
      onFocus={(e) => {
        setFocused(true);
        setDraft(String(value));
        e.target.select();
      }}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        if (raw === '') return;
        const parsed = isInt ? Math.floor(Number(raw)) : Number(raw);
        if (!Number.isFinite(parsed) || parsed < min) return;
        const clamped = max !== undefined ? Math.min(max, parsed) : parsed;
        onCommit(clamped);
      }}
      onBlur={() => {
        setFocused(false);
        const parsed = isInt ? Math.floor(Number(draft)) : Number(draft);
        if (draft === '' || !Number.isFinite(parsed) || parsed < min) {
          setDraft(String(value));
          return;
        }
        const clamped = max !== undefined ? Math.min(max, parsed) : parsed;
        if (onCommit(clamped) === false) setDraft(String(value));
      }}
      className={className}
    />
  );
}

export function TransactionPage({
  kind,
  session,
  products,
  refreshKey = 0,
  cart,
  onChangeCart,
  onRefreshProducts,
  onOpenNote,
  onToast,
}: TransactionPageProps) {
  const isSales = kind === 'sales';
  const isOwner = session.role === 'owner';
  const partyLabel = isSales ? 'Konsumen' : 'Supplier';

  const [tgl, setTgl] = useState(() => isoDate());
  const [party, setParty] = useState(isSales ? 'Umum' : '');
  const [noBukti, setNoBukti] = useState('');
  const [tempoHari, setTempoHari] = useState(0);
  const [keterangan, setKeterangan] = useState('');
  const [discPct, setDiscPct] = useState(0);
  const [discRp, setDiscRp] = useState(0);
  const [updateHpp, setUpdateHpp] = useState(false);
  const [cashPaid, setCashPaid] = useState('');

  const [query, setQuery] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [defaultTier, setDefaultTier] = useState<PriceTier>('harga');
  const [expandedItemIdx, setExpandedItemIdx] = useState<number | null>(null);

  const [parties, setParties] = useState<MasterItem[]>([]);
  const [todayList, setTodayList] = useState<TransactionSummary[]>([]);
  const [saving, setSaving] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [showQris, setShowQris] = useState(false);
  const [storeQris, setStoreQris] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);

  const reqIdRef = useRef<string | null>(null);
  const cartRef = useRef<CartItem[]>(cart);
  cartRef.current = cart;
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchBoxRef = useRef<HTMLDivElement | null>(null);
  const metaPanelRef = useRef<HTMLDivElement | null>(null);

  const productsByKode = useMemo(
    () => new Map(products.map((p) => [p.kode, p])),
    [products],
  );
  const productsByLowerKode = useMemo(
    () => new Map(products.map((p) => [p.kode.toLowerCase(), p])),
    [products],
  );

  // Reset requestId whenever cart or discount changes
  const invalidateReqId = () => {
    reqIdRef.current = null;
  };

  useEffect(() => {
    setTgl(isoDate());
    setParty(isSales ? 'Umum' : '');
    setNoBukti('');
    setTempoHari(0);
    setKeterangan('');
    setDiscPct(0);
    setDiscRp(0);
    setUpdateHpp(false);
    setCashPaid('');
    setQuery('');
    setExpandedItemIdx(null);
    setShowQris(false);
    reqIdRef.current = null;
  }, [kind, isSales]);

  const loadMetaAndList = useCallback(async () => {
    try {
      const [mList, txList, qrisRes] = await Promise.all([
        callApi<MasterItem[]>('getMaster', { t: isSales ? 'konsumen' : 'supplier' }, session),
        callApi<TransactionSummary[]>(
          isSales ? 'getSales' : 'getPurchases',
          { tgl: isoDate() },
          session,
        ),
        isSales
          ? callApi<{ qris: string }>('getStoreQris', {}, session).catch(() => ({ qris: '' }))
          : Promise.resolve({ qris: '' }),
      ]);
      setParties(mList || []);
      setTodayList(txList || []);
      if (isSales && qrisRes) {
        setStoreQris(qrisRes.qris || '');
      }
    } catch {
      // handled gracefully
    }
  }, [isSales, session]);

  useEffect(() => {
    loadMetaAndList();
  }, [loadMetaAndList, refreshKey]);

  useEffect(() => {
    if (window.innerWidth >= 1024 && !document.querySelector('[role="dialog"]')) {
      const id = window.setTimeout(() => searchInputRef.current?.focus(), 60);
      return () => window.clearTimeout(id);
    }
  }, [kind]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);

  // Jatuh tempo always reacts to both tgl and tempoHari
  const tempoDateStr = useMemo(() => {
    if (!tempoHari || tempoHari <= 0 || !tgl) return '';
    const d = new Date(`${tgl}T00:00:00`);
    if (Number.isNaN(d.getTime())) return '';
    d.setDate(d.getDate() + tempoHari);
    return fmtDate(isoDate(d));
  }, [tgl, tempoHari]);

  const quickProducts = useMemo(() => {
    if (!isSales) return products.slice(0, 6);
    const available = products.filter((p) => p.jasa || p.stok > 0);
    const outOfStock = products.filter((p) => !p.jasa && p.stok <= 0);
    return [...available, ...outOfStock].slice(0, 6);
  }, [products, isSales]);

  const suggestions = useMemo(() => {
    const words = norm(query).split(' ').filter(Boolean);
    if (!words.length) return [];
    return products
      .filter((p) => {
        const hay = norm(`${p.kode} ${p.nama} ${p.kategori} ${p.tipe || ''}`);
        return words.every((w) => hay.includes(w));
      })
      .slice(0, 8);
  }, [products, query]);

  const addProductToCart = useCallback(
    (p: Product, qty = 1, tier: PriceTier = defaultTier): boolean => {
      const intQty = Math.floor(qty);
      if (intQty <= 0) {
        onToast('Qty harus lebih dari 0', 'warn');
        return false;
      }
      const currentCart = cartRef.current;
      if (isSales && !p.jasa) {
        if (p.stok <= 0) {
          onToast(`Stok barang "${p.nama}" kosong! Tidak dapat dipilih atau dibeli.`, 'err');
          return false;
        }
        const inCart = currentCart
          .filter((i) => i.kode === p.kode)
          .reduce((sum, i) => sum + i.qty, 0);
        if (inCart + intQty > p.stok) {
          onToast(`Stok ${p.nama} tidak cukup (sisa ${Math.max(0, p.stok - inCart)})`, 'err');
          return false;
        }
      }

      const harga = isSales ? p[tier] || p.harga : p.hpp || 0;
      const existingIdx = currentCart.findIndex(
        (i) => i.kode === p.kode && i.harga === harga && !i.dp && !i.dr,
      );

      let nextCart: CartItem[];
      if (existingIdx >= 0) {
        nextCart = currentCart.map((item, idx) =>
          idx === existingIdx ? { ...item, qty: item.qty + intQty } : item,
        );
      } else {
        nextCart = [
          ...currentCart,
          {
            kode: p.kode,
            nama: p.nama,
            harga,
            qty: intQty,
            satuan: p.satuan || 'Pcs',
            dp: 0,
            dr: 0,
            tier: isSales ? tier : '',
            min: p.harga_min || 0,
            hpp: p.hpp || 0,
          },
        ];
      }
      cartRef.current = nextCart;
      invalidateReqId();
      onChangeCart(nextCart);
      setQuery('');
      setDropdownOpen(false);
      return true;
    },
    [defaultTier, isSales, onChangeCart, onToast],
  );

  const updateCartItem = (
    index: number,
    field: 'harga' | 'qty' | 'dp' | 'dr' | 'tier',
    rawValue: string | number,
  ): boolean => {
    const item = cartRef.current[index];
    if (!item) return false;

    const next = [...cartRef.current];
    if (field === 'tier') {
      const tier = rawValue as PriceTier;
      const prod = productsByKode.get(item.kode);
      next[index] = {
        ...item,
        tier,
        harga: (prod && prod[tier]) || (prod ? prod.harga : item.harga),
      };
    } else if (field === 'qty') {
      const q = Math.floor(Number(rawValue));
      if (!(q > 0)) {
        onToast('Qty minimal 1', 'warn');
        return false;
      }
      if (isSales) {
        const prod = productsByKode.get(item.kode);
        const otherQty = cartRef.current
          .filter((x, i) => x.kode === item.kode && i !== index)
          .reduce((a, x) => a + x.qty, 0);
        if (prod && !prod.jasa && otherQty + q > prod.stok) {
          onToast(`Stok tidak cukup (sisa ${Math.max(0, prod.stok - otherQty)})`, 'err');
          return false;
        }
      }
      next[index] = { ...item, qty: q };
    } else {
      const val = Math.max(0, Number(rawValue) || 0);
      next[index] = { ...item, [field]: field === 'dp' ? Math.min(100, val) : val };
    }

    cartRef.current = next;
    invalidateReqId();
    onChangeCart(next);
    return true;
  };

  const removeCartItem = (index: number) => {
    invalidateReqId();
    onChangeCart((prev) => prev.filter((_, i) => i !== index));
    setExpandedItemIdx((cur) =>
      cur === index ? null : cur !== null && cur > index ? cur - 1 : cur,
    );
  };

  const subtotal = useMemo(
    () => cart.reduce((sum, i) => sum + lineSubtotal(i), 0),
    [cart],
  );
  const totalDisc = Math.min(
    subtotal,
    Math.round((subtotal * Math.min(100, discPct)) / 100 + Math.max(0, discRp)),
  );
  const grandTotal = Math.max(0, subtotal - totalDisc);

  const handleSave = async (extraNote?: string): Promise<boolean> => {
    if (cart.length === 0) {
      onToast('Keranjang masih kosong', 'warn');
      return false;
    }
    if (isSales) {
      const neededByKode: Record<string, number> = {};
      for (const item of cart) {
        neededByKode[item.kode] = (neededByKode[item.kode] || 0) + item.qty;
      }
      for (const [kode, qtyNeed] of Object.entries(neededByKode)) {
        const prod = productsByKode.get(kode);
        if (prod && !prod.jasa) {
          if (prod.stok <= 0) {
            onToast(`Stok barang "${prod.nama}" kosong! Tidak bisa di-checkout.`, 'err');
            return false;
          }
          if (qtyNeed > prod.stok) {
            onToast(
              `Stok "${prod.nama}" tidak cukup (sisa ${prod.stok}). Kurangi qty sebelum checkout.`,
              'err',
            );
            return false;
          }
        }
      }
    }
    if (!reqIdRef.current) {
      reqIdRef.current = createUid();
    }
    const baseNote = keterangan.trim();
    const finalNote = extraNote
      ? baseNote
        ? baseNote.toLowerCase().includes('qris')
          ? baseNote
          : `${baseNote} (${extraNote})`
        : extraNote
      : baseNote;

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        requestId: reqIdRef.current,
        tgl,
        [isSales ? 'konsumen' : 'supplier']: party.trim(),
        no_bukti: noBukti.trim(),
        tempo_hari: tempoHari,
        keterangan: finalNote,
        diskon_persen: discPct,
        diskon_rp: discRp,
        items: cart.map((i) => ({
          kode: i.kode,
          harga: i.harga,
          qty: i.qty,
          diskon_persen: i.dp,
          diskon_rp: i.dr,
        })),
      };
      if (!isSales) {
        payload.updateHpp = updateHpp;
      }

      const saved = await callApi<TransactionNote>(
        isSales ? 'saveSale' : 'savePurchase',
        payload,
        session,
      );

      onChangeCart([]);
      setDiscPct(0);
      setDiscRp(0);
      setCashPaid('');
      setKeterangan('');
      setNoBukti('');
      setTempoHari(0);
      reqIdRef.current = null;

      onToast(`${isSales ? 'Penjualan' : 'Pembelian'} tersimpan: ${saved.no}`, 'ok');
      await onRefreshProducts();
      await loadMetaAndList();
      onOpenNote(saved);
      return true;
    } catch (err) {
      const e = err as Error & { net?: boolean };
      onToast(
        e.message + (e.net ? ' Tekan Simpan lagi, nota tidak akan ganda.' : ''),
        'err',
      );
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleOpenInvoice = async (no: string) => {
    try {
      const note = await callApi<TransactionNote>(
        isSales ? 'getSale' : 'getPurchase',
        { no },
        session,
      );
      onOpenNote(note);
    } catch (err) {
      onToast((err as Error).message, 'err');
    }
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    const exact = productsByLowerKode.get(trimmed.toLowerCase());
    if (exact) {
      addProductToCart(exact, 1);
      return;
    }
    if (suggestions[0]) {
      addProductToCart(suggestions[0], 1);
      return;
    }
    onToast(`Barang "${trimmed}" tidak ditemukan`, 'warn');
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* Left/Center POS Workspace */}
        <div className="lg:col-span-8 space-y-4">
          {/* Product Search & Quick Add */}
          <div
            ref={searchBoxRef}
            className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 p-4 shadow-sm shadow-zinc-900/[0.03]"
          >
            <div className="flex flex-col sm:flex-row gap-2.5">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={query}
                  onFocus={() => setDropdownOpen(true)}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setDropdownOpen(true);
                  }}
                  onKeyDown={handleSearchKeyDown}
                  placeholder="Scan barcode atau ketik nama / kategori barang..."
                  className={`w-full min-h-[46px] pl-10 ${query ? 'pr-10' : 'pr-4'} rounded-xl border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-red-600 focus:border-transparent`}
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery('');
                      setDropdownOpen(false);
                      searchInputRef.current?.focus();
                    }}
                    aria-label="Hapus pencarian barang"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200/70 dark:hover:bg-zinc-700 flex items-center justify-center"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}

                {dropdownOpen && query.trim() && (
                  <div className="absolute left-0 right-0 top-13 z-30 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 shadow-2xl overflow-hidden max-h-80 overflow-y-auto">
                    {suggestions.length === 0 ? (
                      <div className="p-4 text-sm text-zinc-500 text-center">
                        Barang tidak ditemukan
                      </div>
                    ) : (
                      <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                        {suggestions.map((p) => {
                          const isOut = isSales && !p.jasa && p.stok <= 0;
                          return (
                            <button
                              key={p.kode}
                              type="button"
                              onClick={() => addProductToCart(p, 1)}
                              className={`w-full px-4 py-3 flex items-center justify-between gap-3 text-left transition-colors ${
                                isOut
                                  ? 'bg-rose-50/90 dark:bg-rose-950/35 hover:bg-rose-100/80 dark:hover:bg-rose-950/50'
                                  : 'hover:bg-red-50/70 dark:hover:bg-zinc-800'
                              }`}
                            >
                              <div className="min-w-0 flex-1">
                                <div
                                  className={`text-sm font-semibold leading-snug break-words [overflow-wrap:anywhere] ${
                                    isOut
                                      ? 'text-rose-700 dark:text-rose-300'
                                      : 'text-zinc-900 dark:text-white'
                                  }`}
                                >
                                  {p.nama}
                                </div>
                                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                                  {p.kategori} · {p.kode}
                                </div>
                              </div>
                              <div className="text-right shrink-0">
                                <div className="text-sm font-bold font-data text-zinc-900 dark:text-white mb-0.5">
                                  {rp(isSales ? p[defaultTier] || p.harga : p.hpp || 0)}
                                </div>
                                <StockStatusText product={p} />
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                {isSales && (
                  <select
                    value={defaultTier}
                    onChange={(e) => setDefaultTier(e.target.value as PriceTier)}
                    aria-label="Tingkat harga default"
                    className="min-h-[46px] px-3 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-red-600"
                  >
                    {TIERS.map(([val, label]) => (
                      <option key={val} value={val}>
                        {label}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  onClick={() => setShowScanner(true)}
                  aria-label="Scan barcode dengan kamera"
                  className="min-h-[46px] px-4 rounded-xl bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-800 dark:hover:bg-zinc-700 border border-zinc-800 dark:border-zinc-700 text-white text-sm font-semibold flex items-center justify-center gap-2 whitespace-nowrap transition-colors"
                >
                  <Camera className="w-4 h-4 text-red-500 shrink-0" />
                  <span>Scan Barcode</span>
                </button>
              </div>
            </div>

            {/* Quick Tap Strip for Frequent / Available Items */}
            {quickProducts.length > 0 && (
              <div className="mt-3 flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
                <span className="text-xs text-zinc-400 shrink-0">Cepat:</span>
                {quickProducts.map((p) => {
                  const isOut = isSales && !p.jasa && p.stok <= 0;
                  return (
                    <button
                      key={p.kode}
                      type="button"
                      onClick={() => addProductToCart(p, 1)}
                      className={`shrink-0 min-h-[36px] px-3 rounded-lg border text-xs font-medium whitespace-nowrap transition-colors ${
                        isOut
                          ? 'border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-950/60'
                          : 'border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/70 hover:border-red-500 hover:text-red-600 dark:hover:text-red-400 text-zinc-700 dark:text-zinc-200'
                      }`}
                    >
                      {isOut ? '× ' : '+ '}
                      {p.nama.split(' ').slice(0, 3).join(' ')}
                      {isOut ? ' (Kosong)' : ''}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Cart Items */}
          <div className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 overflow-hidden shadow-sm shadow-zinc-900/[0.03]">
            <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-zinc-900 dark:text-white">
                Keranjang ({cart.length} item)
              </h2>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() =>
                    metaPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  }
                  className="lg:hidden text-xs font-semibold text-red-600 dark:text-red-400 hover:underline whitespace-nowrap"
                >
                  Detail &amp; Diskon
                </button>
                {cart.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setConfirmClear(true)}
                    className="text-xs font-semibold text-rose-600 dark:text-rose-400 hover:underline whitespace-nowrap"
                  >
                    Kosongkan
                  </button>
                )}
              </div>
            </div>

            {cart.length === 0 ? (
              <div className="p-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
                Keranjang masih kosong. Cari atau scan barang di atas untuk menambahkan.
              </div>
            ) : (
              <>
                {/* Desktop Table */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-zinc-200 dark:border-zinc-800 text-left text-xs text-zinc-500 dark:text-zinc-400">
                        <th className="py-2.5 pl-4 pr-2 font-semibold">Produk</th>
                        <th className="py-2.5 px-2 font-semibold text-right">
                          {isSales ? 'Harga' : 'HPP'}
                        </th>
                        {isSales && <th className="py-2.5 px-2 font-semibold">Tier</th>}
                        <th className="py-2.5 px-2 font-semibold text-center">Qty</th>
                        <th className="py-2.5 px-2 font-semibold text-right">Disk %</th>
                        <th className="py-2.5 px-2 font-semibold text-right">Disk Rp</th>
                        <th className="py-2.5 px-2 font-semibold text-right">Subtotal</th>
                        <th className="py-2.5 pl-2 pr-4"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {cart.map((item, idx) => {
                        const belowMin =
                          isSales &&
                          ((item.min > 0 && item.harga < item.min) ||
                            (isOwner && item.hpp > 0 && item.harga < item.hpp));
                        return (
                          <tr key={`${item.kode}-${idx}`}>
                            <td className="py-2.5 pl-4 pr-2 max-w-[200px]">
                              <div className="font-semibold text-zinc-900 dark:text-white truncate">
                                {item.nama}
                              </div>
                              <div className="text-[11px] font-data text-zinc-500">
                                {item.kode} · {item.satuan}
                                {belowMin && (
                                  <span className="ml-1.5 text-amber-600 dark:text-amber-400 font-semibold">
                                    · Di bawah {item.harga < item.min ? 'min' : 'HPP'}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-2.5 px-2 text-right">
                              <CartNumInput
                                value={item.harga}
                                min={0}
                                onCommit={(val) => updateCartItem(idx, 'harga', val)}
                                className="w-24 min-h-[38px] px-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-right font-data text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                              />
                            </td>
                            {isSales && (
                              <td className="py-2.5 px-2">
                                <select
                                  value={item.tier}
                                  onChange={(e) => updateCartItem(idx, 'tier', e.target.value)}
                                  className="min-h-[38px] px-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs focus:outline-none focus:ring-2 focus:ring-red-600"
                                >
                                  {TIERS.map(([val, label]) => (
                                    <option key={val} value={val}>
                                      {label}
                                    </option>
                                  ))}
                                </select>
                              </td>
                            )}
                            <td className="py-2.5 px-2">
                              <div className="flex items-center justify-center gap-1">
                                <button
                                  type="button"
                                  onClick={() =>
                                    item.qty > 1
                                      ? updateCartItem(idx, 'qty', item.qty - 1)
                                      : removeCartItem(idx)
                                  }
                                  className="w-8 h-8 rounded-lg border border-zinc-200 dark:border-zinc-700 flex items-center justify-center hover:bg-zinc-100 dark:hover:bg-zinc-800"
                                  aria-label="Kurangi qty"
                                >
                                  <Minus className="w-3.5 h-3.5" />
                                </button>
                                <CartNumInput
                                  value={item.qty}
                                  min={1}
                                  isInt
                                  inputMode="numeric"
                                  onCommit={(val) => updateCartItem(idx, 'qty', val)}
                                  className="w-14 min-h-[36px] px-1 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-center font-data text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                                />
                                <button
                                  type="button"
                                  onClick={() => updateCartItem(idx, 'qty', item.qty + 1)}
                                  className="w-8 h-8 rounded-lg border border-zinc-200 dark:border-zinc-700 flex items-center justify-center hover:bg-zinc-100 dark:hover:bg-zinc-800"
                                  aria-label="Tambah qty"
                                >
                                  <Plus className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                            <td className="py-2.5 px-2 text-right">
                              <CartNumInput
                                value={item.dp}
                                min={0}
                                max={100}
                                onCommit={(val) => updateCartItem(idx, 'dp', val)}
                                className="w-16 min-h-[38px] px-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-right font-data text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                              />
                            </td>
                            <td className="py-2.5 px-2 text-right">
                              <CartNumInput
                                value={item.dr}
                                min={0}
                                onCommit={(val) => updateCartItem(idx, 'dr', val)}
                                className="w-24 min-h-[38px] px-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-right font-data text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                              />
                            </td>
                            <td className="py-2.5 px-2 text-right font-data font-bold text-zinc-900 dark:text-white whitespace-nowrap">
                              {rp(lineSubtotal(item))}
                            </td>
                            <td className="py-2.5 pl-2 pr-4 text-right">
                              <button
                                type="button"
                                onClick={() => removeCartItem(idx)}
                                className="p-2 rounded-lg text-zinc-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                                aria-label="Hapus item"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Mobile Touch-First Cart Cards */}
                <div className="md:hidden divide-y divide-zinc-200 dark:divide-zinc-800">
                  {cart.map((item, idx) => {
                    const isExpanded = expandedItemIdx === idx;
                    const belowMin =
                      isSales &&
                      ((item.min > 0 && item.harga < item.min) ||
                        (isOwner && item.hpp > 0 && item.harga < item.hpp));
                    return (
                      <div key={`${item.kode}-${idx}`} className="p-3.5 space-y-2.5">
                        <div className="flex items-start justify-between gap-2.5">
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold text-sm text-zinc-900 dark:text-white leading-snug break-words [overflow-wrap:anywhere]">
                              {item.nama}
                            </div>
                            <div className="text-xs text-zinc-500 font-data mt-0.5">
                              {rp(item.harga)} / {item.satuan}
                              {belowMin && (
                                <span className="ml-1.5 text-amber-600 dark:text-amber-400 font-semibold">
                                  · Di bawah {item.harga < item.min ? 'min' : 'HPP'}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="text-right shrink-0 pl-1">
                            <div className="font-data font-bold text-sm text-zinc-900 dark:text-white whitespace-nowrap">
                              {rp(lineSubtotal(item))}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() =>
                                item.qty > 1
                                  ? updateCartItem(idx, 'qty', item.qty - 1)
                                  : removeCartItem(idx)
                              }
                              className="w-11 h-11 rounded-xl border border-zinc-300 dark:border-zinc-700 flex items-center justify-center active:scale-95"
                              aria-label="Kurangi"
                            >
                              <Minus className="w-4 h-4" />
                            </button>
                            <CartNumInput
                              value={item.qty}
                              min={1}
                              isInt
                              inputMode="numeric"
                              onCommit={(val) => updateCartItem(idx, 'qty', val)}
                              className="w-14 h-11 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-center font-data font-bold text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                            />
                            <button
                              type="button"
                              onClick={() => updateCartItem(idx, 'qty', item.qty + 1)}
                              className="w-11 h-11 rounded-xl border border-zinc-300 dark:border-zinc-700 flex items-center justify-center active:scale-95"
                              aria-label="Tambah"
                            >
                              <Plus className="w-4 h-4" />
                            </button>
                          </div>

                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setExpandedItemIdx(isExpanded ? null : idx)}
                              className={`min-h-[44px] px-3 rounded-xl border text-xs font-semibold flex items-center gap-1.5 ${
                                isExpanded
                                  ? 'bg-red-50 dark:bg-red-950/40 border-red-300 dark:border-red-700 text-red-700 dark:text-red-400'
                                  : 'border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300'
                              }`}
                            >
                              <SlidersHorizontal className="w-3.5 h-3.5" />
                              Harga/Diskon
                            </button>
                            <button
                              type="button"
                              onClick={() => removeCartItem(idx)}
                              className="w-11 h-11 rounded-xl border border-rose-200 dark:border-rose-900/60 text-rose-600 dark:text-rose-400 flex items-center justify-center"
                              aria-label="Hapus item"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>

                        {isExpanded && (
                          <div className="grid grid-cols-2 gap-2.5 pt-2 border-t border-zinc-100 dark:border-zinc-800">
                            <div>
                              <label className="block text-[11px] font-semibold text-zinc-500 mb-1">
                                {isSales ? 'Harga' : 'HPP'}
                              </label>
                              <CartNumInput
                                value={item.harga}
                                min={0}
                                onCommit={(val) => updateCartItem(idx, 'harga', val)}
                                className="w-full min-h-[42px] px-3 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 font-data text-sm"
                              />
                            </div>
                            {isSales && (
                              <div>
                                <label className="block text-[11px] font-semibold text-zinc-500 mb-1">
                                  Tingkat Harga
                                </label>
                                <select
                                  value={item.tier}
                                  onChange={(e) => updateCartItem(idx, 'tier', e.target.value)}
                                  className="w-full min-h-[42px] px-2.5 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm"
                                >
                                  {TIERS.map(([val, label]) => (
                                    <option key={val} value={val}>
                                      {label}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}
                            <div>
                              <label className="block text-[11px] font-semibold text-zinc-500 mb-1">
                                Diskon %
                              </label>
                              <CartNumInput
                                value={item.dp}
                                min={0}
                                max={100}
                                onCommit={(val) => updateCartItem(idx, 'dp', val)}
                                className="w-full min-h-[42px] px-3 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 font-data text-sm"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] font-semibold text-zinc-500 mb-1">
                                Diskon Rp
                              </label>
                              <CartNumInput
                                value={item.dr}
                                min={0}
                                onCommit={(val) => updateCartItem(idx, 'dr', val)}
                                className="w-full min-h-[42px] px-3 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 font-data text-sm"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Right Checkout & Nota Metadata Panel */}
        <div ref={metaPanelRef} className="lg:col-span-4 space-y-4 lg:sticky lg:top-20 scroll-mt-20">
          <div className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 p-4 space-y-3.5 shadow-sm shadow-zinc-900/[0.03]">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-zinc-900 dark:text-white">
                Detail Nota {isSales ? 'Penjualan' : 'Pembelian'}
              </h2>
              <button
                type="button"
                onClick={() => {
                  if (cart.length > 0) setConfirmClear(true);
                  else {
                    setTgl(isoDate());
                    setParty(isSales ? 'Umum' : '');
                    setNoBukti('');
                    setTempoHari(0);
                    setDiscPct(0);
                    setDiscRp(0);
                    setCashPaid('');
                    setKeterangan('');
                  }
                }}
                className="lg:hidden text-xs font-semibold text-zinc-600 dark:text-zinc-300 hover:text-red-600 dark:hover:text-red-400 inline-flex items-center gap-1"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Nota Baru
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-300 mb-1">
                  Tanggal
                </label>
                <input
                  type="date"
                  value={tgl}
                  onChange={(e) => setTgl(e.target.value)}
                  className="w-full min-h-[42px] px-3 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-300 mb-1">
                  {partyLabel}
                </label>
                <input
                  type="text"
                  list="party-datalist"
                  value={party}
                  onChange={(e) => setParty(e.target.value)}
                  placeholder={isSales ? 'Umum' : 'Nama supplier'}
                  className="w-full min-h-[42px] px-3 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                />
                <datalist id="party-datalist">
                  {parties.map((p) => (
                    <option key={p.id} value={p.nama} />
                  ))}
                </datalist>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-300 mb-1">
                  No. Bukti
                </label>
                <input
                  type="text"
                  value={noBukti}
                  onChange={(e) => setNoBukti(e.target.value)}
                  placeholder="Opsional"
                  className="w-full min-h-[42px] px-3 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-300 mb-1">
                  Tempo (hari)
                </label>
                <CartNumInput
                  value={tempoHari}
                  min={0}
                  isInt
                  inputMode="numeric"
                  onCommit={(val) => setTempoHari(val)}
                  className="w-full min-h-[42px] px-3 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm font-data focus:outline-none focus:ring-2 focus:ring-red-600"
                />
              </div>
            </div>

            {tempoDateStr && (
              <div className="text-xs text-zinc-500 dark:text-zinc-400 flex justify-between px-1">
                <span>Jatuh tempo</span>
                <span className="font-data font-semibold text-zinc-800 dark:text-zinc-200">
                  {tempoDateStr}
                </span>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-300 mb-1">
                Keterangan
              </label>
              <input
                type="text"
                value={keterangan}
                onChange={(e) => setKeterangan(e.target.value)}
                placeholder="Catatan transaksi..."
                className="w-full min-h-[42px] px-3 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
              />
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-300 mb-1">
                  Diskon Total %
                </label>
                <CartNumInput
                  value={discPct}
                  min={0}
                  max={100}
                  onCommit={(val) => {
                    invalidateReqId();
                    setDiscPct(val);
                  }}
                  className="w-full min-h-[42px] px-3 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm font-data focus:outline-none focus:ring-2 focus:ring-red-600"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-300 mb-1">
                  Diskon Total Rp
                </label>
                <CartNumInput
                  value={discRp}
                  min={0}
                  onCommit={(val) => {
                    invalidateReqId();
                    setDiscRp(val);
                  }}
                  className="w-full min-h-[42px] px-3 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm font-data focus:outline-none focus:ring-2 focus:ring-red-600"
                />
              </div>
            </div>

            {!isSales && isOwner && (
              <label className="flex items-center gap-2.5 min-h-[40px] cursor-pointer text-xs font-medium text-zinc-700 dark:text-zinc-200 pt-1">
                <input
                  type="checkbox"
                  checked={updateHpp}
                  onChange={(e) => setUpdateHpp(e.target.checked)}
                  className="w-4 h-4 rounded accent-red-600"
                />
                Perbarui HPP produk sesuai harga beli
              </label>
            )}

            <div className="pt-3 border-t border-zinc-200 dark:border-zinc-800 space-y-1.5">
              <div className="flex justify-between text-xs text-zinc-500 dark:text-zinc-400">
                <span>Subtotal</span>
                <span className="font-data">{rp(subtotal)}</span>
              </div>
              {totalDisc > 0 && (
                <div className="flex justify-between text-xs text-rose-600 dark:text-rose-400">
                  <span>Diskon</span>
                  <span className="font-data">-{rp(totalDisc)}</span>
                </div>
              )}
              <div className="flex justify-between items-baseline pt-1">
                <span className="text-sm font-bold text-zinc-900 dark:text-white">TOTAL</span>
                <span className="text-2xl font-extrabold font-data text-red-600 dark:text-red-400">
                  {rp(grandTotal)}
                </span>
              </div>

              {isSales && grandTotal > 0 && (
                <div className="pt-2.5 mt-1 border-t border-dashed border-zinc-200 dark:border-zinc-800 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <label
                      htmlFor="tx-cash-paid"
                      className="text-xs font-semibold text-zinc-600 dark:text-zinc-300 whitespace-nowrap"
                    >
                      Bayar Tunai (Rp)
                    </label>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => setCashPaid(String(grandTotal))}
                        className="px-2 py-1 rounded-md border border-zinc-200 dark:border-zinc-700 text-[11px] font-semibold hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      >
                        Pas
                      </button>
                      <button
                        type="button"
                        onClick={() => setCashPaid('50000')}
                        className="px-2 py-1 rounded-md border border-zinc-200 dark:border-zinc-700 text-[11px] font-semibold hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      >
                        50rb
                      </button>
                      <button
                        type="button"
                        onClick={() => setCashPaid('100000')}
                        className="px-2 py-1 rounded-md border border-zinc-200 dark:border-zinc-700 text-[11px] font-semibold hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      >
                        100rb
                      </button>
                    </div>
                  </div>
                  <input
                    id="tx-cash-paid"
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={cashPaid}
                    onChange={(e) => setCashPaid(e.target.value)}
                    placeholder="Hitung kembalian (opsional)"
                    className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm font-data focus:outline-none focus:ring-2 focus:ring-red-600"
                  />
                  {cashPaid !== '' && Number(cashPaid) >= 0 && (
                    <div className="flex justify-between items-center text-xs pt-0.5">
                      <span className="text-zinc-500 dark:text-zinc-400">
                        {Number(cashPaid) >= grandTotal ? 'Kembalian' : 'Kurang'}
                      </span>
                      <span
                        className={`font-data font-bold text-sm ${
                          Number(cashPaid) >= grandTotal
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {rp(Math.abs(Number(cashPaid) - grandTotal))}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="hidden lg:flex flex-col gap-2 pt-1">
              {isSales && (
                <button
                  type="button"
                  disabled={saving || cart.length === 0 || grandTotal <= 0}
                  onClick={() => setShowQris(true)}
                  className="w-full min-h-[44px] rounded-xl border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/80 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50 text-zinc-900 dark:text-zinc-100 text-sm font-bold flex items-center justify-center gap-2 transition-colors"
                >
                  <QrCode className="w-4 h-4 text-red-600 dark:text-red-400" />
                  Generate QRIS
                </button>
              )}
              <button
                type="button"
                disabled={saving || cart.length === 0}
                onClick={() => {
                  void handleSave();
                }}
                className="w-full min-h-[46px] rounded-xl bg-gradient-to-r from-red-600 to-rose-700 hover:from-red-700 hover:to-rose-800 disabled:opacity-50 text-white text-sm font-bold flex items-center justify-center gap-2 shadow-md shadow-red-600/20 transition-all"
              >
                <Printer className="w-4 h-4" />
                {saving ? 'Menyimpan...' : 'Simpan & Struk'}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (cart.length > 0) setConfirmClear(true);
                  else {
                    setTgl(isoDate());
                    setParty(isSales ? 'Umum' : '');
                    setNoBukti('');
                    setTempoHari(0);
                    setCashPaid('');
                    setKeterangan('');
                  }
                }}
                className="w-full min-h-[42px] rounded-xl border border-zinc-300 dark:border-zinc-700 text-xs font-semibold text-zinc-700 dark:text-zinc-200 flex items-center justify-center gap-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Nota Baru
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Today's Transaction List */}
      <div className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 p-4 sm:p-5 shadow-sm shadow-zinc-900/[0.03]">
        <h3 className="text-sm font-bold text-zinc-900 dark:text-white mb-3">
          {isSales ? 'Penjualan' : 'Pembelian'} Hari Ini ({todayList.length})
        </h3>
        {todayList.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400 py-4">
            Belum ada nota hari ini.
          </p>
        ) : (
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {todayList.map((row) => (
              <button
                key={row.no}
                type="button"
                onClick={() => handleOpenInvoice(row.no)}
                className="w-full py-3 flex items-center justify-between gap-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50 px-2 rounded-lg transition-colors"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-data font-bold text-sm text-red-600 dark:text-red-400">
                      {row.no}
                    </span>
                    {row.batal && (
                      <span className="text-xs font-semibold text-rose-600 dark:text-rose-400">
                        · Batal
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                    {row.pihak || '-'}
                  </div>
                </div>
                <div className="font-data font-bold text-sm text-zinc-900 dark:text-white shrink-0">
                  {rp(row.total)}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Spacer for mobile/tablet sticky checkout bar */}
      <div className="h-20 lg:hidden" />

      {/* Mobile & Tablet Sticky Checkout Bar above Bottom Nav */}
      <div className="lg:hidden fixed bottom-above-nav inset-x-0 z-30 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-xl border-t border-zinc-200/80 dark:border-zinc-800 px-3 sm:px-4 py-2.5 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
            {cart.length} baris · {party || (isSales ? 'Umum' : 'Supplier')}
          </div>
          <div className="text-base font-extrabold font-data text-zinc-900 dark:text-white">
            {rp(grandTotal)}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isSales && (
            <button
              type="button"
              disabled={saving || cart.length === 0 || grandTotal <= 0}
              onClick={() => setShowQris(true)}
              className="min-h-[44px] px-3 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-700 disabled:opacity-50 text-zinc-900 dark:text-zinc-100 text-xs font-bold flex items-center justify-center gap-1.5 whitespace-nowrap"
            >
              <QrCode className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
              QRIS
            </button>
          )}
          <button
            type="button"
            disabled={saving || cart.length === 0}
            onClick={() => {
              void handleSave();
            }}
            className="min-h-[44px] px-4 rounded-xl bg-gradient-to-r from-red-600 to-rose-700 hover:from-red-700 hover:to-rose-800 disabled:opacity-50 text-white text-sm font-bold flex items-center justify-center gap-2 whitespace-nowrap shadow-md shadow-red-600/20"
          >
            <Printer className="w-4 h-4 shrink-0" />
            {saving ? 'Menyimpan...' : 'Simpan & Struk'}
          </button>
        </div>
      </div>

      {showScanner && (
        <BarcodeModal
          allowContinuous
          onDetected={(code, isContinuous) => {
            const trimmed = code.trim();
            const found = productsByLowerKode.get(trimmed.toLowerCase());
            if (found) {
              const added = addProductToCart(found, 1);
              if (!isContinuous) {
                setShowScanner(false);
              }
              if (added) {
                if (!isContinuous) {
                  onToast(`Ditambahkan: ${found.nama}`, 'ok');
                }
                return { ok: true, message: `Ditambahkan: ${found.nama} (+1)` };
              }
              return {
                ok: false,
                message:
                  !found.jasa && found.stok <= 0
                    ? `Stok "${found.nama}" kosong!`
                    : `Stok ${found.nama} tidak mencukupi`,
              };
            }

            if (!isContinuous) {
              setShowScanner(false);
              setQuery(trimmed);
              setDropdownOpen(true);
              onToast(`Kode "${trimmed}" tidak cocok persis, menampilkan hasil mirip`, 'warn');
            }
            return { ok: false, message: `Kode "${trimmed}" tidak ditemukan` };
          }}
          onClose={() => setShowScanner(false)}
        />
      )}

      {confirmClear && (
        <ConfirmModal
          message="Kosongkan semua item di keranjang saat ini?"
          confirmLabel="Kosongkan"
          danger
          onCancel={() => setConfirmClear(false)}
          onConfirm={() => {
            invalidateReqId();
            onChangeCart([]);
            setDiscPct(0);
            setDiscRp(0);
            setCashPaid('');
            setExpandedItemIdx(null);
            setConfirmClear(false);
          }}
        />
      )}
      {isSales && showQris && (
        <QrisModal
          totalAmount={grandTotal}
          storeQris={storeQris}
          isOwner={isOwner}
          savingSale={saving}
          onSaveStoreQris={async (nextQris) => {
            const res = await callApi<{ qris: string }>('saveStoreQris', { qris: nextQris }, session);
            setStoreQris(res.qris);
            onToast('QRIS toko berhasil disimpan untuk semua perangkat', 'ok');
          }}
          onConfirmPaid={async () => {
            const ok = await handleSave('Pembayaran QRIS');
            if (ok) {
              setShowQris(false);
            }
          }}
          onToast={onToast}
          onClose={() => setShowQris(false)}
        />
      )}
    </div>
  );
}
