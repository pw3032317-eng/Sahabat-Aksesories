import { useCallback, useEffect, useState } from 'react';
import { Edit3, Eye, EyeOff, KeyRound, Mail, Plus, Trash2 } from 'lucide-react';
import { MENUS } from '../constants/branding';
import { callApi } from '../services/api';
import type { PageId, Session, UserAccount, UserRole } from '../types/pos';
import { ConfirmModal, Modal } from '../components/ui/Dialog';

interface AccountPageProps {
  session: Session;
  onToast: (msg: string, type?: 'ok' | 'warn' | 'err' | 'info') => void;
}

const ASSIGNABLE_MENUS = MENUS.filter(
  (m) => !['dashboard', 'utility', 'account'].includes(m.id),
);

export function AccountPage({ session, onToast }: AccountPageProps) {
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [editing, setEditing] = useState<{
    isNew: boolean;
    email: string;
    username: string;
    password: string;
    hasPassword: boolean;
    role: UserRole;
    perms: PageId[];
    aktif: boolean;
  } | null>(null);
  const [showPass, setShowPass] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDeleteEmail, setConfirmDeleteEmail] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    try {
      const list = await callApi<UserAccount[]>('getUsers', {}, session);
      setUsers(list || []);
    } catch (err) {
      onToast((err as Error).message, 'err');
    }
  }, [session, onToast]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const openEditor = (u: UserAccount | null) => {
    setShowPass(false);
    if (!u) {
      setEditing({
        isNew: true,
        email: '',
        username: '',
        password: '',
        hasPassword: false,
        role: 'admin',
        perms: ['sales', 'search', 'product'],
        aktif: true,
      });
    } else {
      setEditing({
        isNew: false,
        email: u.email || '',
        username: u.username,
        password: '',
        hasPassword: Boolean(u.hasPassword),
        role: u.role,
        perms: u.perms === '*' ? ASSIGNABLE_MENUS.map((m) => m.id) : u.perms,
        aktif: u.aktif,
      });
    }
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    const trimmedPass = editing.password.trim();
    if (editing.isNew && trimmedPass.length < 4) {
      onToast('Password minimal 4 karakter (angka atau huruf)', 'warn');
      return;
    }
    if (!editing.isNew && trimmedPass && trimmedPass.length < 4) {
      onToast('Password baru minimal 4 karakter (angka atau huruf)', 'warn');
      return;
    }

    setSaving(true);
    try {
      await callApi(
        'saveUser',
        {
          email: editing.email.trim().toLowerCase(),
          username: editing.username.trim().toLowerCase(),
          ...(trimmedPass ? { password: trimmedPass } : {}),
          role: editing.role,
          perms: editing.perms,
          aktif: editing.aktif,
        },
        session,
      );
      onToast('Akun tersimpan', 'ok');
      setEditing(null);
      await loadUsers();
    } catch (err) {
      onToast((err as Error).message, 'err');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDeleteEmail) return;
    try {
      await callApi('deleteUser', { email: confirmDeleteEmail }, session);
      onToast('Akun dihapus', 'ok');
      setConfirmDeleteEmail(null);
      await loadUsers();
    } catch (err) {
      onToast((err as Error).message, 'err');
      setConfirmDeleteEmail(null);
    }
  };

  const menuLabel = (id: PageId) => MENUS.find((m) => m.id === id)?.label || id;
  const currentEmail = (session.email || '').toLowerCase();

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 shadow-sm shadow-zinc-900/[0.03] p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-zinc-900 dark:text-white">
              Daftar Akun ({users.length})
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              Daftarkan email, username, dan password (min. 4 karakter) agar staf bisa login dari HP atau komputer masing-masing.
            </p>
          </div>
          <button
            type="button"
            onClick={() => openEditor(null)}
            className="min-h-[42px] px-4 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold flex items-center gap-1.5 shadow-sm shadow-red-600/20"
          >
            <Plus className="w-4 h-4" /> Tambah Akun
          </button>
        </div>

        {/* Desktop Table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800 text-left text-xs text-zinc-500 dark:text-zinc-400">
                <th className="py-2.5 px-3 font-semibold">Nama Akun</th>
                <th className="py-2.5 px-3 font-semibold">Email Google</th>
                <th className="py-2.5 px-3 font-semibold">Role</th>
                <th className="py-2.5 px-3 font-semibold">Menu Diizinkan</th>
                <th className="py-2.5 px-3 font-semibold">Status</th>
                <th className="py-2.5 px-3 text-right font-semibold">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {users.map((u) => {
                const isSelf = (u.email || '').toLowerCase() === currentEmail;
                return (
                  <tr key={u.email || u.username} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                    <td className="py-3 px-3 font-semibold font-data text-zinc-900 dark:text-white">
                      {u.username}
                      {isSelf && (
                        <span className="ml-2 text-[10px] font-sans font-bold text-red-600 dark:text-red-400">
                          (Anda)
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-3 font-data text-xs text-zinc-600 dark:text-zinc-300">
                      {u.email || '-'}
                    </td>
                    <td className="py-3 px-3 font-medium">
                      {u.role === 'owner' ? 'Owner' : 'Admin'}
                    </td>
                    <td className="py-3 px-3 text-zinc-600 dark:text-zinc-300">
                      {u.perms === '*'
                        ? 'Semua menu'
                        : u.perms.map(menuLabel).join(', ') || 'Dashboard saja'}
                    </td>
                    <td className="py-3 px-3">
                      <div className="flex flex-col gap-0.5">
                        <span
                          className={`text-xs font-semibold ${
                            u.aktif
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-amber-600 dark:text-amber-400'
                          }`}
                        >
                          {u.aktif ? 'Aktif' : 'Menunggu Aktivasi'}
                        </span>
                        <span className="text-[11px] text-zinc-500 dark:text-zinc-400 inline-flex items-center gap-1">
                          <KeyRound className="w-3 h-3" />
                          {u.hasPassword ? 'Password diatur' : 'Belum ada password'}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-3 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => openEditor(u)}
                        className="min-h-[36px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-semibold mr-1.5"
                      >
                        Ubah
                      </button>
                      {!isSelf && u.email && (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteEmail(u.email!)}
                          className="min-h-[36px] px-3 rounded-lg border border-rose-200 dark:border-rose-900 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 text-xs font-semibold"
                        >
                          Hapus
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Mobile Cards */}
        <div className="md:hidden divide-y divide-zinc-100 dark:divide-zinc-800">
          {users.map((u) => {
            const isSelf = (u.email || '').toLowerCase() === currentEmail;
            return (
              <div key={u.email || u.username} className="py-3 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-data font-bold text-sm text-zinc-900 dark:text-white truncate">
                        {u.username}
                      </span>
                      <span
                        className={`text-[11px] font-semibold ${
                          u.aktif
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-amber-600 dark:text-amber-400'
                        }`}
                      >
                        {u.aktif ? 'Aktif' : 'Nonaktif'}
                      </span>
                    </div>
                    <div className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-1 truncate">
                      <Mail className="w-3 h-3 shrink-0" />
                      <span className="truncate">{u.email || '-'}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => openEditor(u)}
                      aria-label={`Ubah ${u.username}`}
                      className="min-h-[40px] min-w-[40px] rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-center"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    {!isSelf && u.email && (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteEmail(u.email!)}
                        aria-label={`Hapus ${u.username}`}
                        className="min-h-[40px] min-w-[40px] rounded-xl border border-rose-200 dark:border-rose-900 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 flex items-center justify-center"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  {u.role === 'owner' ? 'Owner' : 'Admin'} ·{' '}
                  {u.hasPassword ? 'Password diatur' : 'Belum ada password'} ·{' '}
                  {u.perms === '*'
                    ? 'Semua menu'
                    : u.perms.map(menuLabel).join(', ') || 'Dashboard saja'}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {editing && (
        <Modal
          title={editing.isNew ? 'Tambah Akun Staf' : `Ubah Akun: ${editing.username}`}
          onClose={() => setEditing(null)}
          maxWidth="max-w-md"
        >
          <form onSubmit={handleSaveUser} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-300 mb-1">
                Email Google
              </label>
              <input
                type="email"
                required
                readOnly={!editing.isNew}
                value={editing.email}
                onChange={(e) => {
                  const emailVal = e.target.value;
                  setEditing((prev) => {
                    if (!prev) return prev;
                    const autoUser =
                      prev.isNew && !prev.username
                        ? emailVal
                            .split('@')[0]
                            .toLowerCase()
                            .replace(/[^a-z0-9_]/g, '_')
                            .slice(0, 20)
                        : prev.username;
                    return { ...prev, email: emailVal, username: autoUser };
                  });
                }}
                placeholder="kasir1@gmail.com"
                className="w-full min-h-[44px] px-3.5 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm font-data focus:outline-none focus:ring-2 focus:ring-red-600"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-300 mb-1">
                Username
              </label>
              <input
                type="text"
                required
                value={editing.username}
                onChange={(e) => setEditing({ ...editing, username: e.target.value })}
                placeholder="kasir_pagi"
                className="w-full min-h-[44px] px-3.5 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm font-data focus:outline-none focus:ring-2 focus:ring-red-600"
              />
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">
                3-24 karakter: huruf kecil, angka, atau garis bawah (_).
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-300 mb-1">
                {editing.isNew ? 'Password Login' : 'Password Baru (Opsional)'}
              </label>
              <div className="relative">
                <input
                  type={showPass ? 'text' : 'password'}
                  required={editing.isNew}
                  minLength={4}
                  value={editing.password}
                  onChange={(e) => setEditing({ ...editing, password: e.target.value })}
                  placeholder={
                    editing.isNew
                      ? 'Minimal 4 angka atau huruf/nama'
                      : editing.hasPassword
                        ? 'Kosongkan jika tidak diubah'
                        : 'Atur password (min. 4 karakter)'
                  }
                  className="w-full min-h-[44px] pl-3.5 pr-11 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm font-data focus:outline-none focus:ring-2 focus:ring-red-600"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={showPass ? 'Sembunyikan password' : 'Tampilkan password'}
                  onClick={() => setShowPass((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                >
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">
                Minimal 4 karakter (boleh angka saja, huruf/nama, atau kombinasi).
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-300 mb-1">
                Role
              </label>
              <select
                value={editing.role}
                onChange={(e) =>
                  setEditing({ ...editing, role: e.target.value as UserRole })
                }
                className="w-full min-h-[44px] px-3 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
              >
                <option value="admin">Admin / Kasir</option>
                <option value="owner">Owner</option>
              </select>
            </div>

            {editing.role === 'admin' && (
              <div>
                <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-300 mb-1.5">
                  Menu yang Diizinkan
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {ASSIGNABLE_MENUS.map((m) => {
                    const checked = editing.perms.includes(m.id);
                    return (
                      <label
                        key={m.id}
                        className="flex items-center gap-2 min-h-[38px] px-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-medium cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const next = e.target.checked
                              ? [...editing.perms, m.id]
                              : editing.perms.filter((p) => p !== m.id);
                            setEditing({ ...editing, perms: next });
                          }}
                          className="w-4 h-4 rounded accent-red-600"
                        />
                        <span>{m.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            <label className="flex items-center gap-2.5 min-h-[40px] cursor-pointer text-sm font-medium">
              <input
                type="checkbox"
                checked={editing.aktif}
                onChange={(e) => setEditing({ ...editing, aktif: e.target.checked })}
                className="w-4 h-4 rounded accent-red-600"
              />
              Akun aktif (izinkan akses aplikasi)
            </label>

            <div className="flex justify-end gap-2 pt-2">
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

      {confirmDeleteEmail && (
        <ConfirmModal
          message={`Hapus akun "${confirmDeleteEmail}" secara permanen?`}
          confirmLabel="Hapus Akun"
          danger
          onCancel={() => setConfirmDeleteEmail(null)}
          onConfirm={handleDelete}
        />
      )}
    </div>
  );
}
