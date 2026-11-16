import { useCallback, useEffect, useState } from 'react';
import { Edit3, Plus, Search, Trash2 } from 'lucide-react';
import { MASTER_TABS } from '../constants/branding';
import { callApi } from '../services/api';
import type { MasterItem, MasterType, Session } from '../types/pos';
import { norm } from '../utils/format';
import { ConfirmModal, Modal } from '../components/ui/Dialog';

interface MasterPageProps {
  session: Session;
  onToast: (msg: string, type?: 'ok' | 'warn' | 'err' | 'info') => void;
}

export function MasterPage({ session, onToast }: MasterPageProps) {
  const [activeTab, setActiveTab] = useState<MasterType>('konsumen');
  const [items, setItems] = useState<MasterItem[]>([]);
  const [filterText, setFilterText] = useState('');
  const [editing, setEditing] = useState<{ id: number; nama: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<MasterItem | null>(null);

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const list = await callApi<MasterItem[]>('getMaster', { t: activeTab }, session);
      setItems(list || []);
    } catch (err) {
      onToast((err as Error).message, 'err');
    } finally {
      setLoading(false);
    }
  }, [activeTab, session, onToast]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    const cleanName = editing.nama.replace(/\s+/g, ' ').trim();
    if (!cleanName) {
      onToast('Nama data wajib diisi', 'warn');
      return;
    }
    setSaving(true);
    try {
      await callApi(
        'saveMaster',
        { t: activeTab, id: editing.id, nama: cleanName },
        session,
      );
      onToast('Data master tersimpan', 'ok');
      setEditing(null);
      await loadItems();
    } catch (err) {
      onToast((err as Error).message, 'err');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete || deleting) return;
    setDeleting(true);
    try {
      await callApi('deleteMaster', { t: activeTab, id: confirmDelete.id }, session);
      onToast('Data dihapus', 'ok');
      setConfirmDelete(null);
      await loadItems();
    } catch (err) {
      onToast((err as Error).message, 'err');
      setConfirmDelete(null);
    } finally {
      setDeleting(false);
    }
  };

  const tabTitle = MASTER_TABS.find(([k]) => k === activeTab)?.[1] || '';
  const filtered = items.filter((i) => norm(i.nama).includes(norm(filterText)));

  return (
    <div className="space-y-4">
      <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
        {MASTER_TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              setActiveTab(id);
              setFilterText('');
            }}
            className={`shrink-0 min-h-[40px] px-3.5 rounded-xl border text-xs sm:text-sm font-semibold whitespace-nowrap transition-colors ${
              activeTab === id
                ? 'bg-red-600 border-red-600 text-white shadow-sm shadow-red-600/20'
                : 'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 shadow-sm shadow-zinc-900/[0.03] p-4 sm:p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-zinc-900 dark:text-white">
              {tabTitle} ({items.length})
            </h2>
          </div>

          <div className="flex gap-2">
            <div className="relative flex-1 sm:w-56">
              <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                placeholder="Cari..."
                className="w-full min-h-[42px] pl-9 pr-3 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
              />
            </div>
            <button
              type="button"
              onClick={() => setEditing({ id: 0, nama: '' })}
              className="min-h-[42px] px-4 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold flex items-center gap-1.5 whitespace-nowrap shadow-sm shadow-red-600/20"
            >
              <Plus className="w-4 h-4" /> Tambah
            </button>
          </div>
        </div>

        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {loading && items.length === 0 ? (
            <div className="py-8 text-center text-sm text-zinc-500">Memuat data...</div>
          ) : filtered.length === 0 ? (
            <div className="py-8 text-center text-sm text-zinc-500">Belum ada data.</div>
          ) : (
            filtered.map((item) => (
              <div key={item.id} className="py-3 flex items-center justify-between gap-3">
                <span className="min-w-0 flex-1 font-medium text-sm text-zinc-900 dark:text-white break-words [overflow-wrap:anywhere]">
                  {item.nama}
                </span>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => setEditing({ id: item.id, nama: item.nama })}
                    className="min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-xs font-semibold flex items-center gap-1"
                  >
                    <Edit3 className="w-3.5 h-3.5" /> Ubah
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(item)}
                    className="min-h-[40px] px-3 rounded-xl border border-rose-200 dark:border-rose-900 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 text-xs font-semibold flex items-center gap-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Hapus
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {editing && (
        <Modal
          title={editing.id ? `Ubah ${tabTitle}` : `Tambah ${tabTitle}`}
          onClose={() => setEditing(null)}
          maxWidth="max-w-sm"
        >
          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-300 mb-1">
                Nama
              </label>
              <input
                type="text"
                required
                autoFocus
                value={editing.nama}
                onChange={(e) => setEditing({ ...editing, nama: e.target.value })}
                className="w-full min-h-[44px] px-3.5 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="min-h-[44px] px-4 rounded-xl border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-sm font-semibold"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={saving}
                className="min-h-[44px] px-4 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold shadow-sm shadow-red-600/20"
              >
                {saving ? 'Menyimpan...' : 'Simpan'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {confirmDelete && (
        <ConfirmModal
          message={`Hapus “${confirmDelete.nama}”?`}
          confirmLabel="Hapus"
          danger
          onCancel={() => setConfirmDelete(null)}
          onConfirm={handleDelete}
        />
      )}
    </div>
  );
}
