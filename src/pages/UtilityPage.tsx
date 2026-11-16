import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CalendarClock,
  CheckCircle2,
  DatabaseBackup,
  Download,
  Play,
  RotateCcw,
  Trash2,
  Upload,
} from 'lucide-react';
import { callApi } from '../services/api';
import type { AutoBackupConfig, BackupRecord, Product, Session } from '../types/pos';
import { ConfirmModal, Modal } from '../components/ui/Dialog';

interface UtilityPageProps {
  session: Session;
  onRefreshProducts: () => Promise<Product[] | void>;
  onToast: (msg: string, type?: 'ok' | 'warn' | 'err' | 'info') => void;
}

function getBackupOriginLabel(nama: string): string {
  if (nama.startsWith('auto-sebelum-restore')) return 'Otomatis Sebelum Restore';
  if (nama.startsWith('auto-sebelum-impor')) return 'Otomatis Sebelum Impor';
  if (nama.startsWith('auto_')) return 'Otomatis Harian';
  return 'Manual';
}

export function UtilityPage({
  session,
  onRefreshProducts,
  onToast,
}: UtilityPageProps) {
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [autoConfig, setAutoConfig] = useState<AutoBackupConfig>({
    enabled: true,
    time: '22:00',
    keepCount: 14,
    lastRunDate: '',
    lastRunAt: '',
    lastBackupName: '',
    lastStatus: 'idle',
  });
  const [savingAuto, setSavingAuto] = useState(false);
  const [runningAuto, setRunningAuto] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [confirmPrune, setConfirmPrune] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<BackupRecord | null>(null);
  const [restoreConfirmText, setRestoreConfirmText] = useState('');
  const [restoring, setRestoring] = useState(false);

  const importFileRef = useRef<HTMLInputElement | null>(null);

  const loadBackups = useCallback(async () => {
    try {
      const [list, cfg] = await Promise.all([
        callApi<BackupRecord[]>('listBackups', {}, session),
        callApi<AutoBackupConfig>('getAutoBackupConfig', {}, session),
      ]);
      setBackups(list || []);
      if (cfg) setAutoConfig(cfg);
    } catch (err) {
      onToast((err as Error).message, 'err');
    }
  }, [session, onToast]);

  useEffect(() => {
    loadBackups();
  }, [loadBackups]);

  const handleSaveAutoConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingAuto(true);
    try {
      const saved = await callApi<AutoBackupConfig>(
        'saveAutoBackupConfig',
        {
          enabled: autoConfig.enabled,
          time: autoConfig.time,
          keepCount: autoConfig.keepCount,
        },
        session,
      );
      setAutoConfig(saved);
      onToast(
        saved.enabled
          ? `Backup otomatis harian aktif pukul ${saved.time} WIB`
          : 'Backup otomatis harian dinonaktifkan',
        'ok',
      );
    } catch (err) {
      onToast((err as Error).message, 'err');
    } finally {
      setSavingAuto(false);
    }
  };

  const handleRunAutoNow = async () => {
    setRunningAuto(true);
    try {
      const res = await callApi<{
        ran: boolean;
        config: AutoBackupConfig;
        backup?: BackupRecord;
      }>('runAutoBackupNow', {}, session);
      if (res.config) setAutoConfig(res.config);
      onToast(
        res.backup
          ? `Backup otomatis berhasil: ${res.backup.nama}`
          : 'Backup otomatis dijalankan',
        'ok',
      );
      await loadBackups();
    } catch (err) {
      onToast((err as Error).message, 'err');
    } finally {
      setRunningAuto(false);
    }
  };

  const handleBackupNow = async () => {
    setCreating(true);
    try {
      const created = await callApi<BackupRecord>('backup', {}, session);
      onToast(`Backup selesai: ${created.nama}`, 'ok');
      await loadBackups();
    } catch (err) {
      onToast((err as Error).message, 'err');
    } finally {
      setCreating(false);
    }
  };

  const handlePrune = async () => {
    setConfirmPrune(false);
    try {
      const removed = await callApi<number>('deleteOldBackups', {}, session);
      onToast(`${removed} backup lama dihapus`, 'ok');
      await loadBackups();
    } catch (err) {
      onToast((err as Error).message, 'err');
    }
  };

  const handleRestore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!restoreTarget) return;
    if (restoreConfirmText.trim() !== 'RESTORE') {
      onToast('Ketikan RESTORE tidak cocok', 'warn');
      return;
    }
    setRestoring(true);
    try {
      await callApi(
        'restore',
        { id: restoreTarget.id, konfirmasi: 'RESTORE' },
        session,
      );
      onToast('Restore data selesai', 'ok');
      setRestoreTarget(null);
      setRestoreConfirmText('');
      await onRefreshProducts();
      await loadBackups();
    } catch (err) {
      onToast((err as Error).message, 'err');
    } finally {
      setRestoring(false);
    }
  };

  const handleDownloadSnapshot = async (b: BackupRecord) => {
    setDownloadingId(b.id);
    try {
      const res = await callApi<{ filename: string; json: string }>(
        'downloadBackup',
        { id: b.id },
        session,
      );
      const blob = new Blob([res.json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.filename || `${b.nama}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      onToast(`File ${res.filename} diunduh`, 'ok');
    } catch (err) {
      onToast((err as Error).message, 'err');
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDownloadJson = async () => {
    try {
      const json = await callApi<string>('exportJson', {}, session);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sahabat-pos-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      onToast('File backup JSON diunduh', 'ok');
    } catch (err) {
      onToast((err as Error).message, 'err');
    }
  };

  const handleImportJson = async (file: File) => {
    try {
      const text = await file.text();
      const stats = await callApi<{
        produk: number;
        nota_jual: number;
        nota_beli: number;
        biaya: number;
      }>('importJson', { json: text }, session);
      await onRefreshProducts();
      await loadBackups();
      onToast(
        `Impor selesai: ${stats.produk} produk, ${stats.nota_jual} nota jual`,
        'ok',
      );
    } catch (err) {
      onToast((err as Error).message, 'err');
    } finally {
      if (importFileRef.current) importFileRef.current.value = '';
    }
  };

  return (
    <div className="space-y-4">
      {/* Backup Otomatis Harian */}
      <form
        onSubmit={handleSaveAutoConfig}
        className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 shadow-sm shadow-zinc-900/[0.03] p-4 sm:p-5 space-y-4"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-zinc-100 dark:border-zinc-800">
          <div className="flex items-start gap-3">
            <span className="w-10 h-10 rounded-xl bg-red-50 dark:bg-red-950/50 text-red-600 dark:text-red-400 flex items-center justify-center shrink-0">
              <CalendarClock className="w-5 h-5" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-zinc-900 dark:text-white">
                Backup Database Otomatis Harian
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 leading-snug">
                Simpan cadangan seluruh transaksi, stok barang, biaya, dan master secara otomatis setiap hari.
              </p>
            </div>
          </div>

          <label className="inline-flex items-center gap-2.5 cursor-pointer select-none shrink-0">
            <input
              type="checkbox"
              checked={autoConfig.enabled}
              onChange={(e) =>
                setAutoConfig((prev) => ({ ...prev, enabled: e.target.checked }))
              }
              className="sr-only peer"
            />
            <span className="relative w-11 h-6 rounded-full bg-zinc-300 dark:bg-zinc-700 peer-checked:bg-emerald-600 transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:w-5 after:h-5 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:after:translate-x-5" />
            <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200">
              {autoConfig.enabled ? 'Aktif' : 'Nonaktif'}
            </span>
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 items-end">
          <div>
            <label
              htmlFor="auto-backup-time"
              className="block text-xs font-semibold text-zinc-600 dark:text-zinc-300 mb-1"
            >
              Jam Backup Harian (WIB)
            </label>
            <input
              id="auto-backup-time"
              type="time"
              required
              value={autoConfig.time}
              onChange={(e) =>
                setAutoConfig((prev) => ({ ...prev, time: e.target.value }))
              }
              className="w-full min-h-[42px] px-3.5 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm font-data focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </div>

          <div>
            <label
              htmlFor="auto-backup-keep"
              className="block text-xs font-semibold text-zinc-600 dark:text-zinc-300 mb-1"
            >
              Simpan Riwayat Otomatis
            </label>
            <select
              id="auto-backup-keep"
              value={autoConfig.keepCount}
              onChange={(e) =>
                setAutoConfig((prev) => ({
                  ...prev,
                  keepCount: Number(e.target.value) || 14,
                }))
              }
              className="w-full min-h-[42px] px-3.5 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
            >
              <option value={7}>7 snapshot terbaru (1 minggu)</option>
              <option value={14}>14 snapshot terbaru (2 minggu)</option>
              <option value={30}>30 snapshot terbaru (1 bulan)</option>
            </select>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={savingAuto}
              className="flex-1 min-h-[42px] px-4 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-100 disabled:opacity-60 text-xs sm:text-sm font-semibold whitespace-nowrap"
            >
              {savingAuto ? 'Menyimpan...' : 'Simpan Jadwal'}
            </button>
            <button
              type="button"
              disabled={runningAuto}
              onClick={handleRunAutoNow}
              className="min-h-[42px] px-3.5 rounded-xl border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-60 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap"
            >
              <Play className="w-3.5 h-3.5" />
              {runningAuto ? 'Menjalankan...' : 'Backup Harian Sekarang'}
            </button>
          </div>
        </div>

        <div className="text-xs text-zinc-500 dark:text-zinc-400 flex flex-wrap items-center gap-x-2 gap-y-1">
          <CheckCircle2
            className={`w-3.5 h-3.5 shrink-0 ${
              autoConfig.lastStatus === 'err'
                ? 'text-rose-500'
                : autoConfig.enabled
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-zinc-400'
            }`}
          />
          {autoConfig.lastStatus === 'err' && autoConfig.lastError ? (
            <span className="text-rose-600 dark:text-rose-400 font-medium">
              Terakhir gagal: {autoConfig.lastError}
            </span>
          ) : autoConfig.lastRunAt ? (
            <span>
              Backup otomatis terakhir:{' '}
              <strong className="text-zinc-700 dark:text-zinc-200 font-data">
                {new Date(autoConfig.lastRunAt).toLocaleString('id-ID')}
              </strong>
              {autoConfig.lastBackupName ? ` (${autoConfig.lastBackupName})` : ''}
            </span>
          ) : (
            <span>
              {autoConfig.enabled
                ? `Dijadwalkan setiap hari pukul ${autoConfig.time} WIB (belum ada backup otomatis tercatat).`
                : 'Backup otomatis sedang nonaktif.'}
            </span>
          )}
        </div>
      </form>

      {/* Manual Backup & Ekspor/Impor */}
      <div className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 shadow-sm shadow-zinc-900/[0.03] p-4 sm:p-5 space-y-3">
        <div>
          <h2 className="text-sm font-bold text-zinc-900 dark:text-white">
            Backup Manual &amp; Ekspor / Impor JSON
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Buat snapshot manual kapan saja atau unduh salinan arsip JSON ke perangkat Anda.
          </p>
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            disabled={creating}
            onClick={handleBackupNow}
            className="min-h-[44px] px-4 rounded-xl bg-gradient-to-r from-red-600 to-rose-700 hover:from-red-700 hover:to-rose-800 disabled:opacity-60 text-white text-sm font-semibold flex items-center gap-2 shadow-sm shadow-red-600/20"
          >
            <DatabaseBackup className="w-4 h-4" />
            {creating ? 'Membuat backup...' : 'Backup Sekarang'}
          </button>

          <button
            type="button"
            onClick={() => setConfirmPrune(true)}
            className="min-h-[44px] px-4 rounded-xl border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-sm font-semibold flex items-center gap-1.5"
          >
            <Trash2 className="w-4 h-4" /> Simpan 10 Terbaru
          </button>

          <button
            type="button"
            onClick={handleDownloadJson}
            className="min-h-[44px] px-4 rounded-xl border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-sm font-semibold flex items-center gap-1.5"
          >
            <Download className="w-4 h-4" /> Unduh JSON
          </button>

          <button
            type="button"
            onClick={() => importFileRef.current?.click()}
            className="min-h-[44px] px-4 rounded-xl border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-sm font-semibold flex items-center gap-1.5"
          >
            <Upload className="w-4 h-4" /> Muat JSON
          </button>
          <input
            ref={importFileRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleImportJson(f);
            }}
          />
        </div>
      </div>

      {/* Riwayat Backup Tersimpan */}
      <div className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 shadow-sm shadow-zinc-900/[0.03] p-4 sm:p-5">
        <h3 className="text-sm font-bold text-zinc-900 dark:text-white mb-3">
          Riwayat Backup Tersimpan ({backups.length})
        </h3>

        {backups.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400 py-6 text-center">
            Belum ada backup tersimpan.
          </p>
        ) : (
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {backups.map((b) => (
              <div
                key={b.id}
                className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-sm text-zinc-900 dark:text-white font-data leading-snug break-words [overflow-wrap:anywhere]">
                    {b.nama}
                  </div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 leading-snug break-words [overflow-wrap:anywhere]">
                    <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                      {getBackupOriginLabel(b.nama)}
                    </span>{' '}
                    · {new Date(b.waktu).toLocaleString('id-ID')} ·{' '}
                    {Math.max(1, Math.round(b.ukuran / 1024))} KB · {b.produk} produk ·{' '}
                    {b.nota_jual} nota jual · {b.nota_beli} nota beli
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={downloadingId === b.id}
                    onClick={() => handleDownloadSnapshot(b)}
                    className="min-h-[40px] px-3 rounded-xl border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-60 text-xs font-semibold flex items-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5" />
                    {downloadingId === b.id ? 'Mengunduh...' : 'Unduh'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRestoreTarget(b);
                      setRestoreConfirmText('');
                    }}
                    className="min-h-[40px] px-3.5 rounded-xl border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30 text-xs font-semibold flex items-center gap-1.5"
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> Restore
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {confirmPrune && (
        <ConfirmModal
          message="Hapus backup lama dan simpan 10 snapshot terbaru?"
          confirmLabel="Hapus"
          danger
          onCancel={() => setConfirmPrune(false)}
          onConfirm={handlePrune}
        />
      )}

      {restoreTarget && (
        <Modal
          title={`Restore: ${restoreTarget.nama}`}
          onClose={() => setRestoreTarget(null)}
          maxWidth="max-w-md"
        >
          <form onSubmit={handleRestore} className="space-y-4">
            <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-200 leading-relaxed">
              Pratinjau backup: <strong>{restoreTarget.produk}</strong> produk,{' '}
              <strong>{restoreTarget.nota_jual}</strong> nota jual,{' '}
              <strong>{restoreTarget.nota_beli}</strong> nota beli,{' '}
              <strong>{restoreTarget.biaya}</strong> biaya. Data saat ini akan ditimpa (backup
              otomatis dibuat lebih dulu).
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-300 mb-1">
                Ketik <span className="font-data">RESTORE</span> untuk memastikan
              </label>
              <input
                type="text"
                required
                autoFocus
                value={restoreConfirmText}
                onChange={(e) => setRestoreConfirmText(e.target.value)}
                placeholder="RESTORE"
                className="w-full min-h-[44px] px-3.5 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm font-data focus:outline-none focus:ring-2 focus:ring-red-600"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRestoreTarget(null)}
                className="min-h-[44px] px-4 rounded-xl border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-sm font-semibold"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={restoring}
                className="min-h-[44px] px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold shadow-sm shadow-rose-600/20"
              >
                {restoring ? 'Memulihkan...' : 'Restore Data'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
