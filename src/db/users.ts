import { and, asc, eq, isNotNull, ne, sql } from 'drizzle-orm';
import { db } from './index.ts';
import { users } from './schema.ts';
import { hashPassword, verifyPassword } from '../lib/session-token.ts';
import type { PageId, UserAccount, UserRole } from '../types/pos.ts';

export type DbUserRecord = typeof users.$inferSelect;

export class AuthError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 401) {
    super(message);
    this.name = 'AuthError';
    this.statusCode = statusCode;
  }
}

const ALLOWED_ADMIN_PERMS: PageId[] = [
  'sales',
  'purchase',
  'expense',
  'product',
  'search',
  'report',
  'master',
];

function deriveUsername(email: string, fallbackUid: string): string {
  const local = email.split('@')[0] || '';
  const cleaned = local
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 20);
  if (cleaned.length >= 3) return cleaned;
  return `user_${fallbackUid.slice(0, 6).toLowerCase()}`;
}

export async function getOrCreateUser(uid: string, rawEmail: string): Promise<DbUserRecord> {
  const email = String(rawEmail || '').trim().toLowerCase();
  if (!uid || !email) {
    throw new Error('Data akun Google tidak lengkap.');
  }

  try {
    const existingByUid = await db.select().from(users).where(eq(users.uid, uid)).limit(1);
    if (existingByUid[0]) {
      return existingByUid[0];
    }

    const derivedUsername = deriveUsername(email, uid);
    const upserted = await db
      .insert(users)
      .values({
        uid,
        email,
        username: derivedUsername,
        role: 'admin',
        perms: [],
        aktif: false,
      })
      .onConflictDoUpdate({
        target: users.email,
        set: { uid },
      })
      .returning();

    const currentUser = upserted[0];

    // If no owner exists yet, promote the very first registered user automatically
    const existingOwner = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, 'owner'))
      .limit(1);

    if (!existingOwner[0] && currentUser) {
      const earliest = await db
        .select({ id: users.id })
        .from(users)
        .orderBy(asc(users.id))
        .limit(1);

      if (earliest[0]?.id === currentUser.id) {
        const promoted = await db
          .update(users)
          .set({ role: 'owner', perms: '*', aktif: true })
          .where(eq(users.id, currentUser.id))
          .returning();
        if (promoted[0]) return promoted[0];
      }
    }

    return currentUser;
  } catch (error) {
    console.error('Database user sync failed:', error);
    throw new Error('Gagal memverifikasi akun pengguna di database.', { cause: error });
  }
}

export async function getDbUserByIdAndEmail(
  id: number,
  email: string,
): Promise<DbUserRecord | null> {
  const normalized = String(email || '').trim().toLowerCase();
  if (!id || !normalized) return null;
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  const found = rows[0];
  if (!found || found.email.toLowerCase() !== normalized) return null;
  return found;
}

export async function isAuthInitialized(): Promise<boolean> {
  try {
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.aktif, true), isNotNull(users.passwordHash)))
      .limit(1);
    return rows.length > 0;
  } catch (error) {
    console.error('Failed to check auth initialization:', error);
    return true;
  }
}

export async function registerInitialOwner(input: {
  email?: string;
  username?: string;
  password?: string;
}): Promise<DbUserRecord> {
  const email = String(input.email || '').trim().toLowerCase();
  const username = String(input.username || '').trim().toLowerCase();
  const password = String(input.password || '').trim();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AuthError('Masukkan email yang valid untuk pendaftaran awal Owner.', 400);
  }
  if (!/^[a-z0-9_]{3,24}$/.test(username)) {
    throw new AuthError('Username 3-24 karakter: huruf kecil, angka, atau garis bawah.', 400);
  }
  if (password.length < 4) {
    throw new AuthError('Password minimal 4 karakter (angka atau huruf).', 400);
  }

  try {
    return await db.transaction(async (tx) => {
      const existingReady = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.aktif, true), isNotNull(users.passwordHash)))
        .limit(1);
      if (existingReady.length > 0) {
        throw new AuthError(
          'Pendaftaran awal sudah selesai. Silakan masuk dengan username dan password.',
          409,
        );
      }

      const passwordHash = hashPassword(password);
      const saved = await tx
        .insert(users)
        .values({
          email,
          username,
          passwordHash,
          role: 'owner',
          perms: '*',
          aktif: true,
        })
        .onConflictDoUpdate({
          target: users.email,
          set: {
            username,
            passwordHash,
            role: 'owner',
            perms: '*',
            aktif: true,
          },
        })
        .returning();

      return saved[0];
    });
  } catch (error) {
    if (error instanceof AuthError) throw error;
    console.error('Initial owner registration failed:', error);
    throw new Error('Gagal menyelesaikan pendaftaran awal akun Owner.', { cause: error });
  }
}

export async function authenticateWithCredentials(input: {
  email?: string;
  username?: string;
  password?: string;
}): Promise<DbUserRecord> {
  const email = String(input.email || '').trim().toLowerCase();
  const username = String(input.username || '').trim().toLowerCase();
  const password = String(input.password || '').trim();

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AuthError('Format email tidak valid', 400);
  }
  if (!username) {
    throw new AuthError('Username wajib diisi', 400);
  }
  if (password.length < 4) {
    throw new AuthError('Password minimal 4 karakter (angka atau huruf)', 400);
  }

  try {
    if (email) {
      const byEmail = await db.select().from(users).where(eq(users.email, email)).limit(1);
      const matchedUser = byEmail[0];

      if (!matchedUser) {
        const byUsername = await db
          .select()
          .from(users)
          .where(sql`lower(${users.username}) = ${username}`);
        const validCredsWrongEmail = byUsername.some(
          (u) => Boolean(u.passwordHash) && verifyPassword(password, u.passwordHash),
        );
        if (validCredsWrongEmail) {
          throw new AuthError('Email salah! Gunakan email yang sudah didaftarkan oleh Owner.', 401);
        }
        throw new AuthError('Email salah atau belum didaftarkan oleh Owner.', 401);
      }

      if (matchedUser.username.toLowerCase() !== username) {
        throw new AuthError('Username tidak sesuai dengan akun email tersebut.', 401);
      }

      if (!matchedUser.passwordHash) {
        throw new AuthError(
          'Akun ini belum memiliki password. Hubungi Owner untuk mengatur password di menu Akun.',
          401,
        );
      }

      if (!verifyPassword(password, matchedUser.passwordHash)) {
        throw new AuthError('Password salah.', 401);
      }

      if (!matchedUser.aktif) {
        throw new AuthError(
          'Akun belum diaktifkan oleh Owner. Hubungi Owner untuk mengaktifkan akses.',
          403,
        );
      }

      return matchedUser;
    }

    // Standard login (username + password only)
    const candidates = await db
      .select()
      .from(users)
      .where(sql`lower(${users.username}) = ${username}`)
      .orderBy(asc(users.id));

    if (candidates.length === 0) {
      throw new AuthError('Username tidak terdaftar atau salah.', 401);
    }

    const withPassword = candidates.filter((u) => Boolean(u.passwordHash));
    if (withPassword.length === 0) {
      throw new AuthError(
        'Akun ini belum memiliki password. Hubungi Owner untuk mengatur password di menu Akun.',
        401,
      );
    }

    const passwordMatch = withPassword.find(
      (u) => u.passwordHash && verifyPassword(password, u.passwordHash),
    );
    if (!passwordMatch) {
      throw new AuthError('Password salah.', 401);
    }

    if (!passwordMatch.aktif) {
      throw new AuthError(
        'Akun belum diaktifkan oleh Owner. Hubungi Owner untuk mengaktifkan akses.',
        403,
      );
    }

    return passwordMatch;
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }
    console.error('Credential authentication failed:', error);
    throw new Error('Gagal memeriksa akun ke database.', { cause: error });
  }
}

export async function listDbUsers(): Promise<UserAccount[]> {
  try {
    const rows = await db.select().from(users).orderBy(asc(users.id));
    return rows.map((u) => ({
      username: u.username,
      email: u.email,
      role: u.role === 'owner' ? 'owner' : 'admin',
      perms: u.perms === '*' ? '*' : ((u.perms || []) as PageId[]),
      aktif: u.aktif,
      hasPassword: Boolean(u.passwordHash),
    }));
  } catch (error) {
    console.error('Failed to list users:', error);
    throw new Error('Gagal memuat daftar akun pengguna.', { cause: error });
  }
}

export async function saveDbUser(
  input: {
    email?: string;
    username?: string;
    password?: string;
    role?: string;
    perms?: unknown;
    aktif?: boolean;
  },
  actor: DbUserRecord,
): Promise<UserAccount> {
  const email = String(input.email || '').trim().toLowerCase();
  const username = String(input.username || '').trim().toLowerCase();
  const rawPassword = typeof input.password === 'string' ? input.password.trim() : '';

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Email yang valid wajib diisi');
  }
  if (!/^[a-z0-9_]{3,24}$/.test(username)) {
    throw new Error('Username 3-24 karakter: huruf kecil, angka, atau garis bawah');
  }
  if (rawPassword && rawPassword.length < 4) {
    throw new Error('Password minimal 4 karakter (angka atau huruf)');
  }

  const role: UserRole = input.role === 'owner' ? 'owner' : 'admin';
  const aktif = input.aktif !== false;
  const normalizedPerms: '*' | PageId[] =
    role === 'owner'
      ? '*'
      : Array.isArray(input.perms)
        ? (input.perms.filter((m) => ALLOWED_ADMIN_PERMS.includes(m as PageId)) as PageId[])
        : [];

  if (email === actor.email.toLowerCase() && (role !== actor.role || !aktif)) {
    throw new Error('Tidak dapat mengubah role atau menonaktifkan akun yang sedang dipakai');
  }

  try {
    const dupUsername = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(and(sql`lower(${users.username}) = ${username}`, ne(users.email, email)))
      .limit(1);
    if (dupUsername[0]) {
      throw new Error('Username sudah digunakan akun lain. Gunakan username yang berbeda.');
    }

    const existingRows = await db.select().from(users).where(eq(users.email, email)).limit(1);
    const existingUser = existingRows[0];
    if (!existingUser && !rawPassword) {
      throw new Error('Password minimal 4 karakter wajib diisi untuk akun baru');
    }

    const ownerCountRows = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.role, 'owner'));
    const isOnlyOwner =
      ownerCountRows.length === 1 && ownerCountRows[0].email.toLowerCase() === email;
    if (isOnlyOwner && (role !== 'owner' || !aktif)) {
      throw new Error('Harus ada minimal satu akun Owner yang aktif');
    }

    const nextPasswordHash = rawPassword
      ? hashPassword(rawPassword)
      : (existingUser?.passwordHash ?? null);

    const saved = await db
      .insert(users)
      .values({
        email,
        username,
        passwordHash: nextPasswordHash,
        role,
        perms: normalizedPerms,
        aktif,
      })
      .onConflictDoUpdate({
        target: users.email,
        set: {
          username,
          ...(rawPassword ? { passwordHash: nextPasswordHash } : {}),
          role,
          perms: normalizedPerms,
          aktif,
        },
      })
      .returning();

    const row = saved[0];
    return {
      username: row.username,
      email: row.email,
      role: row.role === 'owner' ? 'owner' : 'admin',
      perms: row.perms === '*' ? '*' : ((row.perms || []) as PageId[]),
      aktif: row.aktif,
      hasPassword: Boolean(row.passwordHash),
    };
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes('Owner') ||
        error.message.includes('Password') ||
        error.message.includes('Username'))
    ) {
      throw error;
    }
    console.error('Failed to save user:', error);
    throw new Error('Gagal menyimpan akun pengguna.', { cause: error });
  }
}

export async function deleteDbUser(emailInput: string, actor: DbUserRecord): Promise<void> {
  const email = String(emailInput || '').trim().toLowerCase();
  if (!email) throw new Error('Email akun wajib diisi');
  if (email === actor.email.toLowerCase()) {
    throw new Error('Tidak dapat menghapus akun yang sedang dipakai');
  }

  try {
    const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!existing[0]) {
      throw new Error('Akun tidak ditemukan');
    }
    if (existing[0].role === 'owner') {
      const owners = await db.select({ id: users.id }).from(users).where(eq(users.role, 'owner'));
      if (owners.length <= 1) {
        throw new Error('Owner terakhir tidak boleh dihapus');
      }
    }
    await db.delete(users).where(eq(users.email, email));
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === 'Akun tidak ditemukan' || error.message.includes('Owner'))
    ) {
      throw error;
    }
    console.error('Failed to delete user:', error);
    throw new Error('Gagal menghapus akun pengguna.', { cause: error });
  }
}
