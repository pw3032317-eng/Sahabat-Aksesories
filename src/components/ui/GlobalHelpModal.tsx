import { ChevronRight, Keyboard } from 'lucide-react';
import { MENUS } from '../../constants/branding';
import type { PageId } from '../../types/pos';
import { Modal } from './Dialog';

interface GlobalHelpModalProps {
  activePage: PageId;
  canAccess: (page: PageId) => boolean;
  onNavigate: (page: PageId) => void;
  onClose: () => void;
}

const MENU_DESCRIPTIONS: Record<PageId, string> = {
  dashboard: 'Ringkasan omset, stok menipis, dan aktivitas kasir',
  sales: 'Buat nota penjualan baru dan proses pembayaran',
  purchase: 'Catat restok barang dan faktur supplier',
  expense: 'Catat biaya dan pengeluaran operasional toko',
  product: 'Tambah, ubah, dan kelola harga serta stok barang',
  search: 'Cek cepat harga jual dan sisa stok barang',
  report: 'Lihat rekap penjualan, laba, pengeluaran, dan stok',
  master: 'Kelola data konsumen, supplier, kategori, dan satuan',
  utility: 'Backup otomatis, pulihkan data, dan atur QRIS toko',
  account: 'Kelola akun pengguna dan hak akses menu',
};

const QUICK_ACTIONS: { keys: string[]; label: string; description: string }[] = [
  {
    keys: ['/', 'Ctrl + K'],
    label: 'Pencarian Global',
    description: 'Cari barang atau nota transaksi dari halaman mana saja',
  },
  {
    keys: ['↑', '↓', 'Enter'],
    label: 'Pilih Hasil Pencarian',
    description: 'Navigasi dan buka barang atau nota dari daftar pencarian',
  },
  {
    keys: ['F10'],
    label: 'Panduan Pintasan',
    description: 'Buka atau tutup jendela panduan pintasan keyboard ini',
  },
  {
    keys: ['Esc'],
    label: 'Tutup Jendela',
    description: 'Tutup dialog, hasil pencarian, atau overlay yang aktif',
  },
];

export function GlobalHelpModal({
  activePage,
  canAccess,
  onNavigate,
  onClose,
}: GlobalHelpModalProps) {
  const menuShortcuts = MENUS.filter((m) => Boolean(m.shortcut));

  return (
    <Modal title="Panduan Pintasan Keyboard" onClose={onClose} maxWidth="max-w-2xl">
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-3 text-xs text-zinc-500 dark:text-zinc-400">
          <div className="flex items-center gap-2">
            <Keyboard className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
            <span>
              Tekan tombol fungsi untuk berpindah menu cepat atau klik baris di bawah.
            </span>
          </div>
          <span className="hidden sm:inline font-data text-zinc-400 dark:text-zinc-500 whitespace-nowrap">
            F10 · Esc
          </span>
        </div>

        <section aria-labelledby="shortcut-menus-heading">
          <h4
            id="shortcut-menus-heading"
            className="text-xs font-bold text-zinc-700 dark:text-zinc-300 mb-2.5"
          >
            Navigasi Menu (F1 – F9)
          </h4>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {menuShortcuts.map((item) => {
              const allowed = canAccess(item.id);
              const isActive = activePage === item.id;
              const desc = MENU_DESCRIPTIONS[item.id];

              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={!allowed}
                  onClick={() => {
                    onClose();
                    onNavigate(item.id);
                  }}
                  className={`group w-full min-h-[54px] px-3.5 py-2.5 rounded-xl border text-left flex items-center gap-3 transition-colors ${
                    !allowed
                      ? 'border-zinc-200/70 dark:border-zinc-800/70 bg-zinc-50/70 dark:bg-zinc-900/40 opacity-55 cursor-not-allowed'
                      : isActive
                        ? 'border-red-300 dark:border-red-800 bg-red-50/80 dark:bg-red-950/35'
                        : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800/60'
                  }`}
                >
                  <kbd
                    className={`min-w-[38px] h-8 px-2 rounded-lg border font-data text-xs font-bold flex items-center justify-center shrink-0 tabular-nums ${
                      isActive
                        ? 'border-red-300 dark:border-red-700 bg-white dark:bg-zinc-900 text-red-700 dark:text-red-300'
                        : 'border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-100'
                    }`}
                  >
                    {item.shortcut}
                  </kbd>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-sm font-semibold text-zinc-900 dark:text-white leading-tight">
                      <span className="truncate">{item.label}</span>
                      {item.ownerOnly && (
                        <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 shrink-0">
                          · Khusus Owner
                        </span>
                      )}
                      {isActive && (
                        <span className="text-[11px] font-semibold text-red-600 dark:text-red-400 shrink-0">
                          · Aktif
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 line-clamp-1">
                      {desc}
                    </p>
                  </div>

                  {allowed && (
                    <ChevronRight className="w-4 h-4 text-zinc-400 group-hover:text-zinc-700 dark:group-hover:text-zinc-200 shrink-0 transition-colors" />
                  )}
                </button>
              );
            })}
          </div>
        </section>

        <section
          aria-labelledby="shortcut-quick-heading"
          className="pt-4 border-t border-zinc-200 dark:border-zinc-800"
        >
          <h4
            id="shortcut-quick-heading"
            className="text-xs font-bold text-zinc-700 dark:text-zinc-300 mb-2.5"
          >
            Pencarian &amp; Kontrol Cepat
          </h4>

          <div className="divide-y divide-zinc-200/80 dark:divide-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
            {QUICK_ACTIONS.map((action) => (
              <div
                key={action.label}
                className="px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 sm:gap-4 bg-white dark:bg-zinc-900"
              >
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-zinc-900 dark:text-white leading-tight">
                    {action.label}
                  </div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                    {action.description}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                  {action.keys.map((keyLabel) => (
                    <kbd
                      key={keyLabel}
                      className="px-2 py-1 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 font-data text-[11px] font-bold text-zinc-800 dark:text-zinc-100 whitespace-nowrap"
                    >
                      {keyLabel}
                    </kbd>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </Modal>
  );
}
