import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Download,
  Edit3,
  PackagePlus,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { PRODUCT_CSV_COLS } from '../constants/branding';
import { callApi } from '../services/api';
import type { MasterItem, MasterType, Product, Session } from '../types/pos';
import { exportToCsv, norm, parseCsvText, rp } from '../utils/format';
import { ConfirmModal, Modal } from '../components/ui/Dialog';
import { StockStatusText } from '../components/ui/ProductDetailModal';

interface ProductPageProps {
  session: Session;
  products: Product[];
  onReload: () => Promise<Product[] | void>;
  onToast: (msg: string, type?: 'ok' | 'warn' | 'err' | 'info') => void;
}

interface ProductFormState {
  originalKode: string;
  kode: string;
  nama: string;
  kategori: string;
  tipe: string;
  hpp: string;
  margin: string;
  laba: string;
  harga: string;
  harga_a: string;
  harga_b: string;
  harga_c: string;
  harga_d: string;
  harga_min: string;
  stok: string;
  satuan: string;
  supplier: string;
  jasa: '0' | '1';
}

const emptyForm = (): ProductFormState => ({
  originalKode: '',
  kode: '',
  nama: '',
  kategori: '',
  tipe: '',
  hpp: '',
  margin: '',
  laba: '0',
  harga: '',
  harga_a: '',
  harga_b: '',
  harga_c: '',
  harga_d: '',
  harga_min: '',
  stok: '0',
  satuan: 'Pcs',
  supplier: '',
  jasa: '0',
});

export function ProductPage({
  session,
  products,
  onReload,
  onToast,
}: ProductPageProps) {
  const isOwner = session.role === 'owner';
  const [form, setForm] = useState<ProductFormState>(() => emptyForm());
  const [masters, setMasters] = useState<Record<string, MasterItem[]>>({});
  const [saving, setSaving] = useState(false);

  const [filterText, setFilterText] = useState('');
  const [sortCol, setSortCol] = useState<'kode' | 'nama' | 'kategori' | 'hpp' | 'harga' | 'stok'>('nama');
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [page, setPage] = useState(1);

  const [confirmDeleteKode, setConfirmDeleteKode] = useState<string | null>(null);
  const [stockModalProduct, setStockModalProduct] = useState<Product | null>(null);
  const [stockDelta, setStockDelta] = useState('');
  const [stockReason, setStockReason] = useState('');
  const [adjustingStock, setAdjustingStock] = useState(false);

  const [duplicateModalProduct, setDuplicateModalProduct] = useState<Product | null>(null);
  const [duplicateServerMsg, setDuplicateServerMsg] = useState('');
  const [importFailures, setImportFailures] = useState<{ baris: number; error: string }[] | null>(
    null,
  );

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const resetBtnRef = useRef<HTMLButtonElement | null>(null);
  const lastAutoPromptedNameRef = useRef<string>('');

  const loadMasters = useCallback(async () => {
    const types: MasterType[] = ['kategori', 'tipe', 'satuan', 'supplier'];
    try {
      const results = await Promise.all(
        types.map((t) => callApi<MasterItem[]>('getMaster', { t }, session)),
      );
      setMasters(
        Object.fromEntries(types.map((t, idx) => [t, results[idx] || []])),
      );
    } catch {
      // ignore
    }
  }, [session]);

  useEffect(() => {
    loadMasters();
  }, [loadMasters]);

  const suggestedKode = useMemo(() => {
    const maxCode = products.reduce((max, p) => {
      const n = Number(p.kode);
      return Number.isFinite(n) && n > max ? n : max;
    }, 1000000);
    return String(maxCode + 1);
  }, [products]);

  const fillFormFromProduct = (p: Product | null) => {
    if (!p) {
      setForm(emptyForm());
      return;
    }
    const hppNum = p.hpp || 0;
    const hargaNum = p.harga || 0;
    const labaNum = hargaNum - hppNum;
    const marginNum = hppNum ? Math.round(((hargaNum - hppNum) / hppNum) * 1000) / 10 : 0;
    setForm({
      originalKode: p.kode,
      kode: p.kode,
      nama: p.nama,
      kategori: p.kategori || '',
      tipe: p.tipe || '',
      hpp: p.hpp !== undefined ? String(p.hpp) : '',
      margin: String(marginNum),
      laba: String(labaNum),
      harga: String(p.harga || ''),
      harga_a: p.harga_a ? String(p.harga_a) : '',
      harga_b: p.harga_b ? String(p.harga_b) : '',
      harga_c: p.harga_c ? String(p.harga_c) : '',
      harga_d: p.harga_d ? String(p.harga_d) : '',
      harga_min: p.harga_min ? String(p.harga_min) : '',
      stok: String(p.stok ?? 0),
      satuan: p.satuan || 'Pcs',
      supplier: p.supplier || '',
      jasa: p.jasa ? '1' : '0',
    });
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const updatePricingField = (field: 'hpp' | 'harga' | 'margin', val: string) => {
    setForm((prev) => {
      const next = { ...prev, [field]: val };
      if (!isOwner) return next;
      const hpp = Number(field === 'hpp' ? val : next.hpp) || 0;
      if (field === 'margin') {
        const m = Number(val) || 0;
        const newHarga = Math.round(hpp * (1 + m / 100));
        next.harga = String(newHarga);
        next.laba = String(newHarga - hpp);
      } else {
        const harga = Number(field === 'harga' ? val : next.harga) || 0;
        next.laba = String(harga - hpp);
        next.margin = hpp ? String(Math.round(((harga - hpp) / hpp) * 1000) / 10) : '0';
      }
      return next;
    });
  };

  const duplicateProduct = useMemo(() => {
    const targetName = norm(form.nama);
    if (!targetName) return null;
    return (
      products.find(
        (p) => norm(p.nama) === targetName && p.kode !== form.originalKode,
      ) || null
    );
  }, [products, form.nama, form.originalKode]);

  const duplicateKodeProduct = useMemo(() => {
    const targetKode = form.kode.trim();
    if (!targetKode) return null;
    return (
      products.find(
        (p) => p.kode === targetKode && p.kode !== form.originalKode,
      ) || null
    );
  }, [products, form.kode, form.originalKode]);

  const openDuplicateModal = useCallback((existing: Product, customMsg = '') => {
    setDuplicateServerMsg(customMsg);
    setDuplicateModalProduct(existing);
  }, []);

  const focusProductNameInput = useCallback(() => {
    setDuplicateModalProduct(null);
    setDuplicateServerMsg('');
    setTimeout(() => {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }, 60);
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanNama = form.nama.replace(/\s+/g, ' ').trim();
    if (!cleanNama) {
      onToast('Nama produk wajib diisi', 'warn');
      nameInputRef.current?.focus();
      return;
    }

    if (duplicateProduct) {
      openDuplicateModal(duplicateProduct);
      return;
    }

    if (duplicateKodeProduct) {
      onToast(
        `Kode ${duplicateKodeProduct.kode} sudah digunakan oleh "${duplicateKodeProduct.nama}"`,
        'warn',
      );
      return;
    }

    setSaving(true);
    try {
      await callApi(
        'saveProduct',
        {
          mode: form.originalKode ? 'edit' : 'create',
          originalKode: form.originalKode,
          kode: form.kode.trim(),
          nama: cleanNama,
          kategori: form.kategori.trim(),
          tipe: form.tipe.trim(),
          hpp: form.hpp,
          harga: form.harga,
          harga_a: form.harga_a,
          harga_b: form.harga_b,
          harga_c: form.harga_c,
          harga_d: form.harga_d,
          harga_min: form.harga_min,
          stok: form.jasa === '1' ? '0' : form.stok,
          satuan: form.satuan.trim() || 'Pcs',
          supplier: form.supplier.trim(),
          jasa: form.jasa,
        },
        session,
      );
      onToast(
        form.originalKode ? 'Produk berhasil diperbarui' : 'Produk baru berhasil ditambahkan',
        'ok',
      );
      lastAutoPromptedNameRef.current = '';
      setForm(emptyForm());
      await onReload();
    } catch (err) {
      const msg = (err as Error).message || 'Gagal menyimpan produk';
      if (/sudah ada|tidak boleh sama|ganda/i.test(msg)) {
        const reloaded = await onReload();
        const latestProducts = Array.isArray(reloaded) ? reloaded : products;
        const match =
          latestProducts.find(
            (p) => norm(p.nama) === norm(cleanNama) && p.kode !== form.originalKode,
          ) || null;
        if (match) {
          openDuplicateModal(match, msg);
        } else {
          setDuplicateServerMsg(msg);
          setDuplicateModalProduct({
            kode: '-',
            nama: cleanNama,
            kategori: form.kategori.trim(),
            tipe: form.tipe.trim(),
            harga: Number(form.harga) || 0,
            harga_a: 0,
            harga_b: 0,
            harga_c: 0,
            harga_d: 0,
            harga_min: 0,
            stok: 0,
            satuan: form.satuan.trim() || 'Pcs',
            supplier: form.supplier.trim(),
            jasa: form.jasa === '1',
          });
        }
      } else {
        onToast(msg, 'err');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDeleteKode) return;
    try {
      await callApi('deleteProduct', { kode: confirmDeleteKode }, session);
      onToast('Produk dihapus', 'ok');
      setConfirmDeleteKode(null);
      if (form.originalKode === confirmDeleteKode) setForm(emptyForm());
      await onReload();
    } catch (err) {
      onToast((err as Error).message, 'err');
    }
  };

  const handleAdjustStock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stockModalProduct) return;
    setAdjustingStock(true);
    try {
      await callApi(
        'adjustStock',
        {
          kode: stockModalProduct.kode,
          delta: stockDelta,
          alasan: stockReason.trim(),
        },
        session,
      );
      onToast('Stok berhasil disesuaikan', 'ok');
      setStockModalProduct(null);
      setStockDelta('');
      setStockReason('');
      await onReload();
    } catch (err) {
      onToast((err as Error).message, 'err');
    } finally {
      setAdjustingStock(false);
    }
  };

  const handleImportCsv = async (file: File) => {
    try {
      const text = await file.text();
      const rows = parseCsvText(text);
      if (rows.length && rows[0][0]?.toLowerCase() === 'kode') {
        rows.shift();
      }
      if (rows.length === 0) {
        onToast('File CSV tidak berisi data produk', 'warn');
        return;
      }
      const objs = rows.map((r) =>
        Object.fromEntries(PRODUCT_CSV_COLS.map((c, idx) => [c, (r[idx] ?? '').trim()])),
      );
      let okCount = 0;
      const errors: { baris: number; error: string }[] = [];
      for (let i = 0; i < objs.length; i += 500) {
        const res = await callApi<{ ok: number; gagal: { baris: number; error: string }[] }>(
          'importProducts',
          { rows: objs.slice(i, i + 500), offset: i },
          session,
        );
        okCount += res.ok;
        errors.push(...res.gagal);
      }
      await onReload();
      if (errors.length > 0) {
        setImportFailures(errors);
        onToast(
          `Impor selesai: ${okCount} berhasil, ${errors.length} dilewati karena duplikat/tidak valid`,
          'warn',
        );
      } else {
        onToast(`Impor selesai: ${okCount} produk berhasil disimpan`, 'ok');
      }
    } catch (err) {
      onToast((err as Error).message, 'err');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleExportCsv = () => {
    exportToCsv(
      'produk-sahabat.csv',
      [...PRODUCT_CSV_COLS],
      products.map((p) =>
        PRODUCT_CSV_COLS.map((col) =>
          col === 'jasa' ? (p.jasa ? 1 : 0) : (p[col] ?? ''),
        ),
      ),
    );
    onToast('File CSV produk diunduh', 'ok');
  };

  const sortedProducts = useMemo(() => {
    const words = norm(filterText).split(' ').filter(Boolean);
    const list = products.filter((p) => {
      if (!words.length) return true;
      const hay = norm(`${p.kode} ${p.nama} ${p.kategori} ${p.tipe || ''}`);
      return words.every((w) => hay.includes(w));
    });
    return [...list].sort((a, b) => {
      if (sortCol === 'hpp' || sortCol === 'harga' || sortCol === 'stok') {
        const na = Number(a[sortCol] ?? 0);
        const nb = Number(b[sortCol] ?? 0);
        return (na - nb) * sortDir;
      }
      return (
        String(a[sortCol] ?? '').localeCompare(String(b[sortCol] ?? ''), 'id', {
          sensitivity: 'base',
        }) * sortDir
      );
    });
  }, [products, filterText, sortCol, sortDir]);

  const pageSize = 15;
  const totalPages = Math.max(1, Math.ceil(sortedProducts.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = sortedProducts.slice((safePage - 1) * pageSize, safePage * pageSize);

  const toggleSort = (col: typeof sortCol) => {
    if (sortCol === col) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortCol(col);
      setSortDir(1);
    }
  };

  return (
    <div className="space-y-4">
      {/* Product Editor Card */}
      <form
        ref={formRef}
        onSubmit={handleSave}
        className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 shadow-sm shadow-zinc-900/[0.03] p-4 sm:p-5 space-y-4"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-zinc-900 dark:text-white">
            {form.originalKode ? `Edit Produk (${form.originalKode})` : 'Tambah Produk Baru'}
          </h2>
          {form.originalKode && (
            <button
              type="button"
              onClick={() => setForm(emptyForm())}
              className="text-xs font-semibold text-red-600 dark:text-red-400 hover:underline"
            >
              + Tambah Baru
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-300 mb-1">
              Kode / Barcode
            </label>
            <input
              type="text"
              value={form.kode}
              onChange={(e) => setForm({ ...form, kode: e.target.value })}
              placeholder={`Otomatis (${suggestedKode})`}
              className="w-full min-h-[42px] px-3 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm font-data focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-300 mb-1">
              Nama Produk * (Harus Unik)
            </label>
            <input
              ref={nameInputRef}
              type="text"
              required
              value={form.nama}
              onChange={(e) => {
                const nextNama = e.target.value;
                if (norm(nextNama) !== lastAutoPromptedNameRef.current) {
                  lastAutoPromptedNameRef.current = '';
                }
                setForm({ ...form, nama: nextNama });
              }}
              onBlur={(e) => {
                if (e.relatedTarget === resetBtnRef.current) return;
                if (duplicateProduct) {
                  const key = norm(duplicateProduct.nama);
                  if (lastAutoPromptedNameRef.current !== key) {
                    lastAutoPromptedNameRef.current = key;
                    openDuplicateModal(duplicateProduct);
                  }
                }
              }}
              placeholder="Contoh: Kabel Data Type-C 1M"
              aria-invalid={duplicateProduct ? 'true' : undefined}
              className={`w-full min-h-[42px] px-3 rounded-xl border bg-white dark:bg-zinc-800 text-sm focus:outline-none focus:ring-2 ${
                duplicateProduct
                  ? 'border-rose-500 dark:border-rose-500 focus:ring-rose-500'
                  : 'border-zinc-300 dark:border-zinc-700 focus:ring-red-600'
              }`}
            />
            {duplicateProduct && (
              <div className="mt-1.5 flex items-start gap-1.5 text-xs text-rose-600 dark:text-rose-400">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span className="leading-snug">
                  Nama barang sudah terdaftar (Kode{' '}
                  <strong className="font-data">{duplicateProduct.kode}</strong>).{' '}
                  <button
                    type="button"
                    onClick={() => openDuplicateModal(duplicateProduct)}
                    className="font-bold underline hover:no-underline"
                  >
                    Lihat catatan
                  </button>
                </span>
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-300 mb-1">
              Kategori
            </label>
            <input
              type="text"
              list="dl-kategori"
              value={form.kategori}
              onChange={(e) => setForm({ ...form, kategori: e.target.value })}
              className="w-full min-h-[42px] px-3 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-300 mb-1">
              Tipe
            </label>
            <input
              type="text"
              list="dl-tipe"
              value={form.tipe}
              onChange={(e) => setForm({ ...form, tipe: e.target.value })}
              className="w-full min-h-[42px] px-3 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </div>

          {isOwner && (
            <>
              <div>
                <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-300 mb-1">
                  HPP (Modal)
                </label>
                <input
                  type="number"
                  min={0}
                  step="any"
                  inputMode="decimal"
                  value={form.hpp}
                  onChange={(e) => updatePricingField('hpp', e.target.value)}
                  className="w-full min-h-[42px] px-3 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm font-data focus:outline-none focus:ring-2 focus:ring-red-600"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-300 mb-1">
                  Margin %
                </label>
                <input
                  type="number"
                  min={0}
                  step="any"
                  inputMode="decimal"
                  value={form.margin}
                  onChange={(e) => updatePricingField('margin', e.target.value)}
                  className="w-full min-h-[42px] px-3 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm font-data focus:outline-none focus:ring-2 focus:ring-red-600"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-300 mb-1">
                  Laba (Umum)
                </label>
                <input
                  type="text"
                  readOnly
                  value={rp(Number(form.laba) || 0)}
                  className="w-full min-h-[42px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50 text-sm font-data text-zinc-500"
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-300 mb-1">
              Harga Jual (Umum) *
            </label>
            <input
              type="number"
              min={1}
              required
              step="any"
              inputMode="decimal"
              value={form.harga}
              onChange={(e) => updatePricingField('harga', e.target.value)}
              className="w-full min-h-[42px] px-3 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm font-data focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-300 mb-1">
              Harga A (Toko)
            </label>
            <input
              type="number"
              min={0}
              step="any"
              inputMode="decimal"
              value={form.harga_a}
              onChange={(e) => setForm({ ...form, harga_a: e.target.value })}
              className="w-full min-h-[42px] px-3 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm font-data focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-300 mb-1">
              Harga B
            </label>
            <input
              type="number"
              min={0}
              step="any"
              inputMode="decimal"
              value={form.harga_b}
              onChange={(e) => setForm({ ...form, harga_b: e.target.value })}
              className="w-full min-h-[42px] px-3 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm font-data focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-300 mb-1">
              Harga C
            </label>
            <input
              type="number"
              min={0}
              step="any"
              inputMode="decimal"
              value={form.harga_c}
              onChange={(e) => setForm({ ...form, harga_c: e.target.value })}
              className="w-full min-h-[42px] px-3 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm font-data focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-300 mb-1">
              Harga D
            </label>
            <input
              type="number"
              min={0}
              step="any"
              inputMode="decimal"
              value={form.harga_d}
              onChange={(e) => setForm({ ...form, harga_d: e.target.value })}
              className="w-full min-h-[42px] px-3 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm font-data focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-300 mb-1">
              Harga Minimum
            </label>
            <input
              type="number"
              min={0}
              step="any"
              inputMode="decimal"
              value={form.harga_min}
              onChange={(e) => setForm({ ...form, harga_min: e.target.value })}
              className="w-full min-h-[42px] px-3 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm font-data focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-300 mb-1">
              {form.originalKode ? 'Stok Saat Ini' : 'Stok Awal'}
            </label>
            <input
              type="number"
              min={0}
              disabled={form.jasa === '1'}
              inputMode="numeric"
              value={form.jasa === '1' ? '0' : form.stok}
              onChange={(e) => setForm({ ...form, stok: e.target.value })}
              className="w-full min-h-[42px] px-3 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 disabled:opacity-50 text-sm font-data focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-300 mb-1">
              Satuan
            </label>
            <input
              type="text"
              list="dl-satuan"
              value={form.satuan}
              onChange={(e) => setForm({ ...form, satuan: e.target.value })}
              className="w-full min-h-[42px] px-3 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-300 mb-1">
              Supplier
            </label>
            <input
              type="text"
              list="dl-supplier"
              value={form.supplier}
              onChange={(e) => setForm({ ...form, supplier: e.target.value })}
              className="w-full min-h-[42px] px-3 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-300 mb-1">
              Jasa Service
            </label>
            <select
              value={form.jasa}
              onChange={(e) => setForm({ ...form, jasa: e.target.value as '0' | '1' })}
              className="w-full min-h-[42px] px-3 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
            >
              <option value="0">Tidak (Barang Fisik)</option>
              <option value="1">Ya (Jasa / Tanpa Stok)</option>
            </select>
          </div>
        </div>

        {(['kategori', 'tipe', 'satuan', 'supplier'] as const).map((t) => (
          <datalist key={t} id={`dl-${t}`}>
            {(masters[t] || []).map((item) => (
              <option key={item.id} value={item.nama} />
            ))}
          </datalist>
        ))}

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="submit"
            disabled={saving}
            className="min-h-[44px] px-5 rounded-xl bg-gradient-to-r from-red-600 to-rose-700 hover:from-red-700 hover:to-rose-800 disabled:opacity-50 text-white text-sm font-semibold flex items-center gap-2 shadow-sm shadow-red-600/20"
          >
            <Plus className="w-4 h-4" />
            {saving ? 'Menyimpan...' : 'Simpan Produk'}
          </button>

          <button
            ref={resetBtnRef}
            type="button"
            onClick={() => {
              lastAutoPromptedNameRef.current = '';
              setForm(emptyForm());
            }}
            className="min-h-[44px] px-4 rounded-xl border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-sm font-semibold"
          >
            Baru / Reset
          </button>

          {form.originalKode && (
            <button
              type="button"
              onClick={() => setConfirmDeleteKode(form.originalKode)}
              className="min-h-[44px] px-4 rounded-xl border border-rose-300 dark:border-rose-800 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 text-sm font-semibold flex items-center gap-1.5"
            >
              <Trash2 className="w-4 h-4" /> Hapus
            </button>
          )}

          <div className="flex gap-2 sm:ml-auto">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="min-h-[44px] px-4 rounded-xl border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-sm font-semibold flex items-center gap-1.5"
            >
              <Upload className="w-4 h-4" /> Impor CSV
            </button>
            <button
              type="button"
              onClick={handleExportCsv}
              className="min-h-[44px] px-4 rounded-xl border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-sm font-semibold flex items-center gap-1.5"
            >
              <Download className="w-4 h-4" /> Ekspor CSV
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleImportCsv(f);
              }}
            />
          </div>
        </div>
      </form>

      {/* Product List Card */}
      <div className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 shadow-sm shadow-zinc-900/[0.03] p-4 sm:p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={filterText}
              onChange={(e) => {
                setFilterText(e.target.value);
                setPage(1);
              }}
              placeholder="Filter produk..."
              className={`w-full min-h-[42px] pl-10 ${filterText ? 'pr-10' : 'pr-4'} rounded-xl border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-red-600`}
            />
            {filterText && (
              <button
                type="button"
                onClick={() => {
                  setFilterText('');
                  setPage(1);
                }}
                aria-label="Hapus filter produk"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200/70 dark:hover:bg-zinc-700 flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <span className="text-xs text-zinc-500 dark:text-zinc-400 font-data">
            {sortedProducts.length} barang · Halaman {safePage} / {totalPages}
          </span>
        </div>

        {/* Desktop Table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800 text-left text-xs text-zinc-500 dark:text-zinc-400">
                {(
                  [
                    ['kode', 'Kode', false],
                    ['nama', 'Produk', false],
                    ['kategori', 'Kategori', false],
                    ...(isOwner ? [['hpp', 'HPP', true] as const] : []),
                    ['harga', 'Harga', true],
                    ['stok', 'Stok', true],
                  ] as const
                ).map(([key, label, isNum]) => (
                  <th
                    key={key}
                    onClick={() => toggleSort(key)}
                    className={`py-2.5 px-3 font-semibold cursor-pointer select-none hover:text-zinc-900 dark:hover:text-white ${
                      isNum ? 'text-right' : ''
                    }`}
                  >
                    {label}
                    {sortCol === key ? (sortDir > 0 ? ' ▲' : ' ▼') : ''}
                  </th>
                ))}
                <th className="py-2.5 px-3 text-right font-semibold">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {pageRows.length === 0 ? (
                <tr>
                  <td colSpan={isOwner ? 7 : 6} className="py-8 text-center text-zinc-500">
                    Belum ada produk.
                  </td>
                </tr>
              ) : (
                pageRows.map((p) => {
                  const isEmpty = !p.jasa && p.stok <= 0;
                  return (
                    <tr
                      key={p.kode}
                      className={
                        isEmpty
                          ? 'bg-rose-50/85 dark:bg-rose-950/30 hover:bg-rose-100/80 dark:hover:bg-rose-950/45 transition-colors'
                          : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors'
                      }
                    >
                      <td className="py-2.5 px-3 font-data text-zinc-500">{p.kode}</td>
                      <td
                        className={`py-2.5 px-3 font-semibold max-w-md leading-snug break-words [overflow-wrap:anywhere] ${
                          isEmpty ? 'text-rose-700 dark:text-rose-300' : 'text-zinc-900 dark:text-white'
                        }`}
                      >
                        {p.nama}
                      </td>
                      <td className="py-2.5 px-3 text-zinc-600 dark:text-zinc-300">
                        {p.kategori || '-'}
                      </td>
                      {isOwner && (
                        <td className="py-2.5 px-3 text-right font-data">{rp(p.hpp || 0)}</td>
                      )}
                      <td className="py-2.5 px-3 text-right font-data font-semibold">
                        {rp(p.harga)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-data">
                        <StockStatusText product={p} compact />
                      </td>
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => fillFormFromProduct(p)}
                          className="min-h-[36px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-semibold mr-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        >
                          Ubah
                        </button>
                        {!p.jasa && (
                          <button
                            type="button"
                            onClick={() => setStockModalProduct(p)}
                            className="min-h-[36px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-semibold hover:bg-zinc-100 dark:hover:bg-zinc-800"
                          >
                            Stok
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile Card List */}
        <div className="md:hidden divide-y divide-zinc-100 dark:divide-zinc-800">
          {pageRows.length === 0 ? (
            <div className="py-8 text-center text-sm text-zinc-500">Belum ada produk.</div>
          ) : (
            pageRows.map((p) => {
              const isEmpty = !p.jasa && p.stok <= 0;
              return (
                <div
                  key={p.kode}
                  className={`py-3 px-2.5 -mx-2.5 rounded-xl flex items-center justify-between gap-3 transition-colors ${
                    isEmpty ? 'bg-rose-50/85 dark:bg-rose-950/30' : ''
                  }`}
                >
                  <div className="min-w-0 flex-1 pr-1">
                    <div
                      className={`font-semibold text-sm leading-snug break-words [overflow-wrap:anywhere] ${
                        isEmpty ? 'text-rose-700 dark:text-rose-300' : 'text-zinc-900 dark:text-white'
                      }`}
                    >
                      {p.nama}
                    </div>
                    <div className="text-xs text-zinc-500 dark:text-zinc-400 font-data mt-1 flex items-center gap-1.5 flex-wrap">
                      <span>{p.kode}</span>
                      <span>·</span>
                      <span>{rp(p.harga)}</span>
                      <span>·</span>
                      <StockStatusText product={p} />
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => fillFormFromProduct(p)}
                      aria-label={`Ubah ${p.nama}`}
                      className="min-h-[40px] min-w-[40px] rounded-xl border border-zinc-200 dark:border-zinc-700 flex items-center justify-center hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    {!p.jasa && (
                      <button
                        type="button"
                        onClick={() => setStockModalProduct(p)}
                        aria-label={`Sesuaikan stok ${p.nama}`}
                        className="min-h-[40px] min-w-[40px] rounded-xl border border-zinc-200 dark:border-zinc-700 flex items-center justify-center hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      >
                        <PackagePlus className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="min-h-[42px] px-4 rounded-xl border border-zinc-300 dark:border-zinc-700 disabled:opacity-40 text-sm font-semibold hover:bg-zinc-50 dark:hover:bg-zinc-800"
            >
              Sebelumnya
            </button>
            <span className="text-xs font-data text-zinc-500">
              {safePage} / {totalPages}
            </span>
            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="min-h-[42px] px-4 rounded-xl border border-zinc-300 dark:border-zinc-700 disabled:opacity-40 text-sm font-semibold hover:bg-zinc-50 dark:hover:bg-zinc-800"
            >
              Berikutnya
            </button>
          </div>
        )}
      </div>

      {confirmDeleteKode && (
        <ConfirmModal
          message={`Hapus produk ${confirmDeleteKode} secara permanen?`}
          confirmLabel="Hapus Produk"
          danger
          onCancel={() => setConfirmDeleteKode(null)}
          onConfirm={handleDelete}
        />
      )}

      {stockModalProduct && (
        <Modal
          title={`Penyesuaian Stok: ${stockModalProduct.nama}`}
          onClose={() => setStockModalProduct(null)}
          maxWidth="max-w-sm"
        >
          <form onSubmit={handleAdjustStock} className="space-y-4">
            <div className="text-xs text-zinc-500 dark:text-zinc-400">
              Stok saat ini:{' '}
              <strong className="font-data text-zinc-900 dark:text-white">
                {stockModalProduct.stok} {stockModalProduct.satuan}
              </strong>
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-300 mb-1">
                Perubahan (+ tambah, - kurang)
              </label>
              <input
                type="number"
                required
                value={stockDelta}
                onChange={(e) => setStockDelta(e.target.value)}
                placeholder="Contoh: 5 atau -2"
                className="w-full min-h-[44px] px-3.5 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm font-data focus:outline-none focus:ring-2 focus:ring-red-600"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-300 mb-1">
                Alasan (wajib)
              </label>
              <input
                type="text"
                required
                value={stockReason}
                onChange={(e) => setStockReason(e.target.value)}
                placeholder="Contoh: Stok opname / barang rusak"
                className="w-full min-h-[44px] px-3.5 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setStockModalProduct(null)}
                className="min-h-[44px] px-4 rounded-xl border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-sm font-semibold"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={adjustingStock}
                className="min-h-[44px] px-4 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold shadow-sm shadow-red-600/20"
              >
                {adjustingStock ? 'Menyimpan...' : 'Simpan'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Duplicate Product Name Warning Pop-up */}
      {duplicateModalProduct && (
        <Modal
          title="Catatan: Barang Sudah Ada"
          onClose={focusProductNameInput}
          maxWidth="max-w-md"
        >
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/90 dark:bg-rose-950/35 p-3.5">
              <div className="w-10 h-10 rounded-xl bg-rose-100 dark:bg-rose-900/50 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="min-w-0 space-y-1">
                <div className="text-sm font-bold text-rose-900 dark:text-rose-200">
                  Nama Barang Tidak Boleh Sama / Ganda
                </div>
                <p className="text-xs text-rose-700 dark:text-rose-300 leading-relaxed">
                  {duplicateServerMsg ||
                    'Barang dengan nama ini sudah terdaftar di daftar produk. Barang tidak dapat ditambahkan dua kali untuk menjaga keakuratan stok dan laporan.'}
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-950/50 p-3.5 space-y-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                  Barang yang Sudah Terdaftar
                </div>
                <div className="mt-0.5 text-sm font-bold text-zinc-900 dark:text-white leading-snug break-words [overflow-wrap:anywhere]">
                  {duplicateModalProduct.nama}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 pt-2.5 border-t border-zinc-200/80 dark:border-zinc-800 text-xs">
                <div>
                  <div className="text-zinc-500 dark:text-zinc-400">Kode / Barcode</div>
                  <div className="font-data font-bold text-zinc-900 dark:text-white mt-0.5">
                    {duplicateModalProduct.kode}
                  </div>
                </div>
                <div>
                  <div className="text-zinc-500 dark:text-zinc-400">Kategori</div>
                  <div className="font-semibold text-zinc-900 dark:text-white mt-0.5 truncate">
                    {duplicateModalProduct.kategori || '-'}
                  </div>
                </div>
                <div>
                  <div className="text-zinc-500 dark:text-zinc-400">Harga Jual</div>
                  <div className="font-data font-bold text-zinc-900 dark:text-white mt-0.5">
                    {rp(duplicateModalProduct.harga)}
                  </div>
                </div>
                <div>
                  <div className="text-zinc-500 dark:text-zinc-400">Stok Saat Ini</div>
                  <div className="font-data font-bold mt-0.5">
                    <StockStatusText product={duplicateModalProduct} />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:justify-end gap-2 pt-1">
              {duplicateModalProduct.kode !== '-' && !duplicateModalProduct.jasa && (
                <button
                  type="button"
                  onClick={() => {
                    const target = duplicateModalProduct;
                    setDuplicateModalProduct(null);
                    setDuplicateServerMsg('');
                    setStockModalProduct(target);
                  }}
                  className="min-h-[42px] px-3.5 rounded-xl border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-semibold flex items-center justify-center gap-1.5"
                >
                  <PackagePlus className="w-4 h-4 shrink-0" />
                  Sesuaikan Stok
                </button>
              )}
              {duplicateModalProduct.kode !== '-' && (
                <button
                  type="button"
                  onClick={() => {
                    const target = duplicateModalProduct;
                    setDuplicateModalProduct(null);
                    setDuplicateServerMsg('');
                    fillFormFromProduct(target);
                  }}
                  className="min-h-[42px] px-3.5 rounded-xl border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-semibold flex items-center justify-center gap-1.5"
                >
                  <Edit3 className="w-4 h-4 shrink-0" />
                  Ubah Barang Ini
                </button>
              )}
              <button
                type="button"
                onClick={focusProductNameInput}
                className="min-h-[42px] px-4 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold shadow-sm shadow-red-600/20"
              >
                Ganti Nama Lain
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* CSV Import Partial Failure / Duplicate Summary */}
      {importFailures && importFailures.length > 0 && (
        <Modal
          title={`Catatan Impor CSV (${importFailures.length} Dilewati)`}
          onClose={() => setImportFailures(null)}
          maxWidth="max-w-md"
        >
          <div className="space-y-3">
            <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">
              Baris berikut tidak disimpan karena nama barang sudah ada atau data tidak valid:
            </p>
            <div className="max-h-60 overflow-y-auto rounded-xl border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-100 dark:divide-zinc-800 text-xs">
              {importFailures.map((f, i) => (
                <div key={`${f.baris}-${i}`} className="p-2.5 flex items-start gap-2">
                  <span className="font-data font-bold text-rose-600 dark:text-rose-400 shrink-0">
                    Baris {f.baris}:
                  </span>
                  <span className="text-zinc-700 dark:text-zinc-200 break-words [overflow-wrap:anywhere]">
                    {f.error}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setImportFailures(null)}
                className="min-h-[42px] px-4 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold"
              >
                Mengerti
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
