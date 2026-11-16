import { AlertCircle, ShoppingCart } from 'lucide-react';
import type { Product } from '../../types/pos';
import { priceOf, rp } from '../../utils/format';
import { Modal } from './Dialog';

interface ProductDetailModalProps {
  product: Product;
  isOwner: boolean;
  canSell: boolean;
  onAddToCart: (product: Product) => boolean;
  onClose: () => void;
}

export function StockStatusText({
  product,
  compact = false,
}: {
  product: Product;
  compact?: boolean;
}) {
  if (product.jasa) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-red-50 dark:bg-red-950/50 border border-red-200/80 dark:border-red-800/70 text-[11px] font-bold text-red-600 dark:text-red-400">
        Jasa
      </span>
    );
  }
  if (product.stok <= 0) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-rose-100 dark:bg-rose-950/80 border border-rose-300 dark:border-rose-800 text-[11px] font-bold text-rose-700 dark:text-rose-300">
        {compact ? 'Kosong (0)' : 'Stok Kosong (0)'}
      </span>
    );
  }
  if (product.stok <= 3) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/70 border border-amber-300 dark:border-amber-800 text-[11px] font-bold text-amber-800 dark:text-amber-300">
        Menipis · {product.stok}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
      {compact ? product.stok : `Tersedia · ${product.stok}`}
    </span>
  );
}

export function ProductDetailModal({
  product,
  isOwner,
  canSell,
  onAddToCart,
  onClose,
}: ProductDetailModalProps) {
  const isOutOfStock = !product.jasa && product.stok <= 0;
  const rows: [string, string][] = [
    ['Kode', product.kode],
    ['Kategori', product.kategori || '-'],
    ['Tipe', product.tipe || '-'],
    ['Stok', product.jasa ? 'Jasa service' : `${product.stok} ${product.satuan || 'Pcs'}`],
    ['Harga Umum', rp(product.harga)],
    ['Harga Toko (A)', product.harga_a ? rp(product.harga_a) : '-'],
    ['Sekalian Pasang', rp(priceOf(product, 'pasang'))],
    ['Harga B', product.harga_b ? rp(product.harga_b) : '-'],
    ['Harga C', product.harga_c ? rp(product.harga_c) : '-'],
    ['Harga D', product.harga_d ? rp(product.harga_d) : '-'],
    ['Supplier', product.supplier || '-'],
  ];

  if (isOwner) {
    rows.push(['HPP', rp(product.hpp || 0)]);
    rows.push(['Laba (Umum)', rp(product.harga - (product.hpp || 0))]);
  }

  return (
    <Modal title={product.nama} onClose={onClose} maxWidth="max-w-md">
      <div className="mb-3 flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
        <span>
          {product.kategori || 'Produk'} · {product.kode}
        </span>
        <StockStatusText product={product} />
      </div>

      {isOutOfStock && (
        <div className="mb-3 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 flex items-center gap-2 text-xs font-semibold text-rose-700 dark:text-rose-300">
          <AlertCircle className="w-4 h-4 shrink-0" />
          Stok barang kosong! Barang tidak dapat dipilih untuk transaksi atau di-checkout.
        </div>
      )}

      <div className="divide-y divide-zinc-200 dark:divide-zinc-800 border-y border-zinc-200 dark:border-zinc-800">
        {rows.map(([label, val]) => (
          <div key={label} className="flex items-center justify-between py-2.5 text-sm gap-4">
            <span className="text-zinc-500 dark:text-zinc-400">{label}</span>
            <span className="font-semibold text-zinc-900 dark:text-white font-data text-right">
              {val}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-5 flex items-center justify-end gap-2.5">
        <button
          type="button"
          onClick={onClose}
          className="min-h-[44px] px-4 rounded-xl border border-zinc-300 dark:border-zinc-700 text-sm font-semibold text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          Tutup
        </button>
        {canSell && (
          <button
            type="button"
            onClick={() => {
              const added = onAddToCart(product);
              if (added) onClose();
            }}
            className={`min-h-[44px] px-4 rounded-xl text-sm font-semibold flex items-center gap-2 ${
              isOutOfStock
                ? 'bg-rose-100 dark:bg-rose-950/60 border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300'
                : 'bg-gradient-to-r from-red-600 to-rose-700 hover:from-red-700 hover:to-rose-800 text-white shadow-sm shadow-red-600/20'
            }`}
          >
            <ShoppingCart className="w-4 h-4" />
            {isOutOfStock ? 'Stok Kosong' : 'Tambah ke Nota'}
          </button>
        )}
      </div>
    </Modal>
  );
}
