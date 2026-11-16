import { useCallback, useEffect, useRef, useState } from 'react';
import { Edit3, Plus, Trash2 } from 'lucide-react';
import { callApi } from '../services/api';
import type { Expense, MasterItem, Session } from '../types/pos';
import { fmtDate, isoDate, rp } from '../utils/format';
import { ConfirmModal } from '../components/ui/Dialog';

interface ExpensePageProps {
  session: Session;
  onToast: (msg: string, type?: 'ok' | 'warn' | 'err' | 'info') => void;
}

export function ExpensePage({ session, onToast }: ExpensePageProps) {
  const today = isoDate();
  const [nomor, setNomor] = useState('');
  const [tgl, setTgl] = useState(today);
  const [kategori, setKategori] = useState('');
  const [keterangan, setKeterangan] = useState('');
  const [jumlah, setJumlah] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [dari, setDari] = useState(`${today.slice(0, 8)}01`);
  const [sampai, setSampai] = useState(today);
  const dateRangeRef = useRef({ dari, sampai });
  dateRangeRef.current = { dari, sampai };

  const [list, setList] = useState<Expense[]>([]);
  const [categories, setCategories] = useState<MasterItem[]>([]);
  const [confirmDeleteNomor, setConfirmDeleteNomor] = useState<string | null>(null);

  const loadExpenses = useCallback(
    async (start?: string, end?: string) => {
      const s = start ?? dateRangeRef.current.dari;
      const e = end ?? dateRangeRef.current.sampai;
      if (s && e && s > e) {
        onToast('Tanggal awal melebihi tanggal akhir', 'warn');
        return;
      }
      setLoading(true);
      try {
        const [rows, cats] = await Promise.all([
          callApi<Expense[]>('getExpenses', { dari: s, sampai: e }, session),
          callApi<MasterItem[]>('getMaster', { t: 'biaya' }, session),
        ]);
        setList(rows || []);
        setCategories(cats || []);
      } catch (err) {
        onToast((err as Error).message, 'err');
      } finally {
        setLoading(false);
      }
    },
    [session, onToast],
  );

  useEffect(() => {
    loadExpenses();
  }, [loadExpenses]);

  const resetForm = () => {
    setNomor('');
    setTgl(today);
    setKategori('');
    setKeterangan('');
    setJumlah('');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await callApi(
        'saveExpense',
        { nomor, tgl, kategori: kategori.trim(), keterangan: keterangan.trim(), jumlah },
        session,
      );
      onToast('Biaya tersimpan', 'ok');
      resetForm();
      await loadExpenses();
    } catch (err) {
      onToast((err as Error).message, 'err');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDeleteNomor || deleting) return;
    setDeleting(true);
    try {
      await callApi('deleteExpense', { nomor: confirmDeleteNomor }, session);
      onToast('Biaya dihapus', 'ok');
      if (nomor === confirmDeleteNomor) resetForm();
      setConfirmDeleteNomor(null);
      await loadExpenses();
    } catch (err) {
      onToast((err as Error).message, 'err');
    } finally {
      setDeleting(false);
    }
  };

  const totalAmount = list.reduce((sum, item) => sum + item.jumlah, 0);

  return (
    <div className="space-y-4">
      <form
        onSubmit={handleSave}
        className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 p-4 sm:p-5 space-y-4 shadow-sm shadow-zinc-900/[0.03]"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-zinc-900 dark:text-white">
            {nomor ? `Edit Biaya (${nomor})` : 'Catat Biaya Operasional'}
          </h2>
          {nomor && (
            <button
              type="button"
              onClick={resetForm}
              className="text-xs font-semibold text-red-600 dark:text-red-400 hover:underline"
            >
              + Baru
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-300 mb-1">
              Tanggal
            </label>
            <input
              type="date"
              required
              value={tgl}
              onChange={(e) => setTgl(e.target.value)}
              className="w-full min-h-[42px] px-3 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-300 mb-1">
              Kategori *
            </label>
            <input
              type="text"
              required
              list="expense-categories"
              value={kategori}
              onChange={(e) => setKategori(e.target.value)}
              placeholder="Listrik, Sewa, Gaji..."
              className="w-full min-h-[42px] px-3 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
            />
            <datalist id="expense-categories">
              {categories.map((c) => (
                <option key={c.id} value={c.nama} />
              ))}
            </datalist>
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-300 mb-1">
              Keterangan
            </label>
            <input
              type="text"
              value={keterangan}
              onChange={(e) => setKeterangan(e.target.value)}
              placeholder="Detail pengeluaran..."
              className="w-full min-h-[42px] px-3 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-300 mb-1">
              Jumlah (Rp) *
            </label>
            <input
              type="number"
              required
              min={1}
              step="any"
              inputMode="decimal"
              value={jumlah}
              onChange={(e) => setJumlah(e.target.value)}
              placeholder="0"
              className="w-full min-h-[42px] px-3 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm font-data focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </div>
        </div>

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={saving}
            className="min-h-[44px] px-5 rounded-xl bg-gradient-to-r from-red-600 to-rose-700 hover:from-red-700 hover:to-rose-800 disabled:opacity-50 text-white text-sm font-semibold flex items-center gap-2 shadow-sm shadow-red-600/20"
          >
            <Plus className="w-4 h-4" />
            {saving ? 'Menyimpan...' : 'Simpan Biaya'}
          </button>
          <button
            type="button"
            onClick={resetForm}
            className="min-h-[44px] px-4 rounded-xl border border-zinc-300 dark:border-zinc-700 text-sm font-semibold hover:bg-zinc-50 dark:hover:bg-zinc-800"
          >
            Reset
          </button>
        </div>
      </form>

      <div className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 p-4 sm:p-5 space-y-4 shadow-sm shadow-zinc-900/[0.03]">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
          <div>
            <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-300 mb-1">
              Dari Tanggal
            </label>
            <input
              type="date"
              value={dari}
              onChange={(e) => setDari(e.target.value)}
              className="w-full min-h-[42px] px-3 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-300 mb-1">
              Sampai Tanggal
            </label>
            <input
              type="date"
              value={sampai}
              onChange={(e) => setSampai(e.target.value)}
              className="w-full min-h-[42px] px-3 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={() => loadExpenses(dari, sampai)}
            className="min-h-[42px] px-4 rounded-xl border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50 text-sm font-semibold"
          >
            {loading ? 'Memuat...' : 'Tampilkan'}
          </button>
        </div>

        {/* Desktop Table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800 text-left text-xs text-zinc-500 dark:text-zinc-400">
                <th className="py-2.5 px-3 font-semibold">Nomor</th>
                <th className="py-2.5 px-3 font-semibold">Tanggal</th>
                <th className="py-2.5 px-3 font-semibold">Kategori</th>
                <th className="py-2.5 px-3 font-semibold">Keterangan</th>
                <th className="py-2.5 px-3 font-semibold text-right">Jumlah</th>
                <th className="py-2.5 px-3 text-right font-semibold">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {list.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-zinc-500">
                    Belum ada biaya pada rentang tanggal ini.
                  </td>
                </tr>
              ) : (
                list.map((item) => (
                  <tr key={item.nomor} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                    <td className="py-2.5 px-3 font-data text-zinc-600 dark:text-zinc-300">
                      {item.nomor}
                    </td>
                    <td className="py-2.5 px-3 font-data">{fmtDate(item.tgl)}</td>
                    <td className="py-2.5 px-3 font-semibold text-zinc-900 dark:text-white">
                      {item.kategori}
                    </td>
                    <td className="py-2.5 px-3 text-zinc-600 dark:text-zinc-300">
                      {item.keterangan || '-'}
                    </td>
                    <td className="py-2.5 px-3 text-right font-data font-bold">
                      {rp(item.jumlah)}
                    </td>
                    <td className="py-2.5 px-3 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => {
                          setNomor(item.nomor);
                          setTgl(item.tgl);
                          setKategori(item.kategori);
                          setKeterangan(item.keterangan);
                          setJumlah(String(item.jumlah));
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className="min-h-[36px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-semibold mr-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      >
                        Ubah
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteNomor(item.nomor)}
                        className="min-h-[36px] px-3 rounded-lg border border-rose-200 dark:border-rose-900 text-rose-600 dark:text-rose-400 text-xs font-semibold hover:bg-rose-50 dark:hover:bg-rose-950/30"
                      >
                        Hapus
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-zinc-200 dark:border-zinc-700 font-bold">
                <td colSpan={4} className="py-3 px-3 text-right">
                  Total Biaya
                </td>
                <td className="py-3 px-3 text-right font-data text-base text-red-600 dark:text-red-400">{rp(totalAmount)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Mobile Cards */}
        <div className="md:hidden divide-y divide-zinc-100 dark:divide-zinc-800">
          {list.length === 0 ? (
            <div className="py-8 text-center text-sm text-zinc-500">
              Belum ada biaya pada rentang tanggal ini.
            </div>
          ) : (
            list.map((item) => (
              <div key={item.nomor} className="py-3 flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-sm text-zinc-900 dark:text-white break-words [overflow-wrap:anywhere]">
                    {item.kategori}
                  </div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400 break-words [overflow-wrap:anywhere]">
                    {fmtDate(item.tgl)} · {item.keterangan || item.nomor}
                  </div>
                  <div className="font-data font-bold text-sm text-zinc-900 dark:text-white mt-0.5">
                    {rp(item.jumlah)}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setNomor(item.nomor);
                      setTgl(item.tgl);
                      setKategori(item.kategori);
                      setKeterangan(item.keterangan);
                      setJumlah(String(item.jumlah));
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    aria-label="Ubah biaya"
                    className="min-h-[40px] min-w-[40px] rounded-xl border border-zinc-200 dark:border-zinc-700 flex items-center justify-center"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteNomor(item.nomor)}
                    aria-label="Hapus biaya"
                    className="min-h-[40px] min-w-[40px] rounded-xl border border-rose-200 dark:border-rose-900 text-rose-600 flex items-center justify-center"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))
          )}
          <div className="pt-3 flex items-center justify-between font-bold text-sm">
            <span>Total Biaya</span>
            <span className="font-data text-base text-red-600 dark:text-red-400">{rp(totalAmount)}</span>
          </div>
        </div>
      </div>

      {confirmDeleteNomor && (
        <ConfirmModal
          message={`Hapus catatan biaya ${confirmDeleteNomor}?`}
          confirmLabel="Hapus"
          danger
          onCancel={() => setConfirmDeleteNomor(null)}
          onConfirm={handleDelete}
        />
      )}
    </div>
  );
}
