import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { db } from './index.ts';
import {
  backups,
  expenses,
  masterItems,
  products,
  storeSettings,
  transactionItems,
  transactions,
} from './schema.ts';
import type { DbUserRecord } from './users.ts';
import type {
  AutoBackupConfig,
  BackupRecord,
  DailyCumulativePoint,
  DashboardData,
  Expense,
  GlobalTransactionSearchItem,
  MasterItem,
  MasterType,
  MonthlySalesMetric,
  NoteItem,
  Product,
  SalesCategorySummary,
  SalesGroupKey,
  SalesGroupMomSummary,
  SalesGroupSummary,
  SalesMomComparison,
  SalesTrendPoint,
  TransactionNote,
  TransactionSummary,
} from '../types/pos.ts';
import { isoDate, num } from '../utils/format.ts';
import { parseQrisInfo } from '../utils/qris.ts';

export class PosDomainError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'PosDomainError';
    this.statusCode = statusCode;
  }
}

const DEFAULT_MASTER: Record<MasterType, string[]> = {
  konsumen: ['Umum', 'Budi', 'Siti', 'Andi', 'Rina', 'Konter Maju'],
  supplier: ['Grosir Jaya', 'Mitra Seluler', 'Distro Gadget'],
  biaya: ['Listrik', 'Gaji', 'Sewa', 'Internet', 'Perlengkapan Toko'],
  kartu: ['Telkomsel', 'XL', 'Indosat', 'Tri', 'Smartfren'],
  kategori: [
    'Garskin',
    'Casing',
    'Charger',
    'Kabel Data',
    'Tempered Glass',
    'Earphone',
    'Powerbank',
    'Aksesoris',
    'Jasa Service',
    'Pulsa',
  ],
  tipe: ['Universal', 'Samsung', 'Oppo', 'Vivo', 'Xiaomi', 'iPhone'],
  satuan: ['Pcs', 'Unit', 'Lembar', 'Jasa'],
};

const VALID_MASTER_TYPES = new Set<MasterType>([
  'konsumen',
  'supplier',
  'biaya',
  'kartu',
  'kategori',
  'tipe',
  'satuan',
]);

function mapProductRow(row: typeof products.$inferSelect, isOwner: boolean): Product {
  return {
    kode: row.kode,
    nama: row.nama,
    kategori: row.kategori,
    tipe: row.tipe,
    hpp: isOwner ? row.hpp : undefined,
    harga: row.harga,
    harga_a: row.hargaA,
    harga_b: row.hargaB,
    harga_c: row.hargaC,
    harga_d: row.hargaD,
    harga_min: row.hargaMin,
    stok: row.stok,
    satuan: row.satuan,
    supplier: row.supplier,
    jasa: row.jasa,
  };
}

function mapTransactionRow(
  row: typeof transactions.$inferSelect,
  items: (typeof transactionItems.$inferSelect)[],
): TransactionNote {
  const mappedItems: NoteItem[] = items.map((it) => ({
    kode: it.kode,
    nama: it.nama,
    harga: it.harga,
    qty: it.qty,
    satuan: it.satuan,
    diskon_rp: it.diskonRp,
    subtotal: it.subtotal,
  }));
  return {
    no: row.no,
    tgl: row.tgl,
    ...(row.kind === 'sales' ? { konsumen: row.party || 'Umum' } : { supplier: row.party || '' }),
    no_bukti: row.noBukti,
    tempo_hari: row.tempoHari,
    tempo_tgl: row.tempoTgl,
    diskon_persen: row.diskonPersen,
    diskon_rp: row.diskonRp,
    subtotal: row.subtotal,
    diskon: row.diskon,
    total: row.total,
    keterangan: row.keterangan,
    kasir: row.kasir,
    batal: row.batal,
    ...(row.alasan ? { alasan: row.alasan } : {}),
    hpp: row.hppTotal,
    items: mappedItems,
  };
}

function normalizeProductName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function cleanProductInput(
  d: Record<string, unknown>,
  isOwner: boolean,
  old?: typeof products.$inferSelect,
) {
  const t = (k: string) => String(d[k] ?? '').trim();
  return {
    kode: t('kode'),
    nama: t('nama').replace(/\s+/g, ' '),
    kategori: t('kategori'),
    tipe: t('tipe'),
    hpp: isOwner ? Math.round(num(d.hpp)) : (old?.hpp ?? 0),
    harga: Math.round(num(d.harga)),
    hargaA: Math.round(num(d.harga_a)),
    hargaB: Math.round(num(d.harga_b)),
    hargaC: Math.round(num(d.harga_c)),
    hargaD: Math.round(num(d.harga_d)),
    hargaMin: Math.round(num(d.harga_min)),
    stok: Math.floor(num(d.stok)),
    satuan: t('satuan') || 'Pcs',
    supplier: t('supplier'),
    jasa: /^(1|ya|true)$/i.test(t('jasa')),
  };
}

function handleDbError(context: string, err: unknown): never {
  if (err instanceof PosDomainError) {
    throw err;
  }
  const pgErr = err as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
  const code = pgErr?.code || pgErr?.cause?.code;
  const constraint = pgErr?.constraint || pgErr?.cause?.constraint || '';
  if (code === '23505') {
    if (constraint.includes('nama') || constraint.includes('name')) {
      throw new PosDomainError('Nama data sudah terdaftar dan tidak boleh ganda.', 409);
    }
    throw new PosDomainError('Data sudah ada (duplikat) dan tidak dapat disimpan.', 409);
  }
  console.error(`${context}:`, err);
  throw new Error('Operasi database gagal. Silakan coba lagi.', { cause: err });
}

export async function ensureDefaultMasterSeeded(): Promise<void> {
  try {
    const existing = await db.select({ id: masterItems.id }).from(masterItems).limit(1);
    if (existing.length > 0) return;

    const rows: { type: string; nama: string }[] = [];
    for (const [type, names] of Object.entries(DEFAULT_MASTER)) {
      for (const nama of names) {
        rows.push({ type, nama });
      }
    }
    if (rows.length > 0) {
      await db.insert(masterItems).values(rows).onConflictDoNothing();
    }
  } catch (err) {
    console.error('Seed default master failed:', err);
  }
}

export async function getDbProducts(isOwner: boolean): Promise<Product[]> {
  try {
    const rows = await db.select().from(products).orderBy(products.id);
    return rows.map((r) => mapProductRow(r, isOwner));
  } catch (err) {
    handleDbError('getDbProducts', err);
  }
}

async function generateNextProductKode(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
): Promise<string> {
  const existing = await tx.select({ kode: products.kode }).from(products);
  const maxNum = existing.reduce((max, item) => {
    const parsed = Number(item.kode);
    return Number.isFinite(parsed) && parsed > max ? parsed : max;
  }, 1000000);
  return String(maxNum + 1);
}

async function upsertProductWithTx(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  d: Record<string, unknown>,
  isOwner: boolean,
): Promise<Product> {
  const nama = String(d.nama || '').trim().replace(/\s+/g, ' ');
  if (!nama) throw new PosDomainError('Nama produk wajib diisi');
  if (!(Number(d.harga) > 0)) throw new PosDomainError('Harga jual harus lebih dari 0');

  const reqKode = String(d.kode || '').trim();
  const isCreateMode = d.mode === 'create';
  const originalKode = isCreateMode ? '' : String(d.originalKode || reqKode).trim();

  const oldRows = originalKode
    ? await tx.select().from(products).where(eq(products.kode, originalKode)).limit(1)
    : [];
  const old = oldRows[0];
  const cleaned = cleanProductInput(d, isOwner, old);

  // Enforce unique product name (case-insensitive, collapsed spaces) across all products
  const normalizedName = normalizeProductName(nama);
  const sameNameRows = await tx
    .select({ id: products.id, kode: products.kode, nama: products.nama })
    .from(products)
    .where(sql`regexp_replace(lower(trim(${products.nama})), '[[:space:]]+', ' ', 'g') = ${normalizedName}`)
    .limit(1);
  if (sameNameRows[0] && (!old || sameNameRows[0].id !== old.id)) {
    throw new PosDomainError(
      `Barang dengan nama "${sameNameRows[0].nama}" sudah ada (Kode: ${sameNameRows[0].kode}). Nama barang tidak boleh sama atau ganda.`,
      409,
    );
  }

  if (old) {
    if (reqKode && reqKode !== old.kode) {
      const conflict = await tx
        .select({ id: products.id })
        .from(products)
        .where(eq(products.kode, reqKode))
        .limit(1);
      if (conflict[0]) {
        throw new PosDomainError(`Kode produk ${reqKode} sudah dipakai produk lain`, 409);
      }
    }
    const finalKode = reqKode || old.kode;
    const updated = await tx
      .update(products)
      .set({
        ...cleaned,
        kode: finalKode,
        updatedAt: new Date(),
      })
      .where(eq(products.id, old.id))
      .returning();
    return mapProductRow(updated[0], isOwner);
  }

  if (reqKode) {
    const conflict = await tx
      .select({ id: products.id })
      .from(products)
      .where(eq(products.kode, reqKode))
      .limit(1);
    if (conflict[0]) {
      throw new PosDomainError(`Kode produk ${reqKode} sudah terdaftar`, 409);
    }
  }

  const finalKode = reqKode || (await generateNextProductKode(tx));
  const inserted = await tx
    .insert(products)
    .values({
      ...cleaned,
      kode: finalKode,
    })
    .returning();
  return mapProductRow(inserted[0], isOwner);
}

export async function saveDbProduct(
  data: Record<string, unknown>,
  isOwner: boolean,
): Promise<Product> {
  try {
    return await db.transaction((tx) => upsertProductWithTx(tx, data, isOwner));
  } catch (err) {
    handleDbError('saveDbProduct', err);
  }
}

export async function deleteDbProduct(kode: string): Promise<boolean> {
  const cleanKode = String(kode || '').trim();
  if (!cleanKode) throw new PosDomainError('Kode produk wajib diisi');
  try {
    const deleted = await db
      .delete(products)
      .where(eq(products.kode, cleanKode))
      .returning({ id: products.id });
    if (!deleted[0]) throw new PosDomainError('Produk tidak ditemukan', 404);
    return true;
  } catch (err) {
    handleDbError('deleteDbProduct', err);
  }
}

export async function adjustDbStock(
  kode: string,
  deltaInput: unknown,
  alasanInput: unknown,
): Promise<{ stok: number }> {
  const cleanKode = String(kode || '').trim();
  const delta = Math.trunc(Number(deltaInput));
  const alasan = String(alasanInput || '').trim();
  if (!cleanKode) throw new PosDomainError('Kode produk wajib diisi');
  if (!alasan) throw new PosDomainError('Alasan wajib diisi');
  if (!delta || !Number.isFinite(delta)) throw new PosDomainError('Perubahan stok tidak boleh 0');

  try {
    return await db.transaction(async (tx) => {
      const found = await tx
        .select()
        .from(products)
        .where(eq(products.kode, cleanKode))
        .for('update')
        .limit(1);
      const p = found[0];
      if (!p) throw new PosDomainError('Produk tidak ditemukan', 404);
      if (p.stok + delta < 0) throw new PosDomainError('Stok tidak boleh negatif');

      const updated = await tx
        .update(products)
        .set({ stok: p.stok + delta, updatedAt: new Date() })
        .where(eq(products.id, p.id))
        .returning({ stok: products.stok });
      return { stok: updated[0].stok };
    });
  } catch (err) {
    handleDbError('adjustDbStock', err);
  }
}

export async function importDbProducts(
  rowsInput: unknown,
  offsetInput: unknown,
  isOwner: boolean,
): Promise<{ ok: number; gagal: { baris: number; error: string }[] }> {
  const rows = Array.isArray(rowsInput) ? (rowsInput as Record<string, unknown>[]) : [];
  const offset = Number(offsetInput) || 0;
  if (rows.length > 500) {
    throw new PosDomainError('Maksimal 500 baris per permintaan');
  }

  const gagal: { baris: number; error: string }[] = [];
  let ok = 0;

  try {
    for (let i = 0; i < rows.length; i++) {
      try {
        await db.transaction((tx) => upsertProductWithTx(tx, rows[i], isOwner));
        ok++;
      } catch (e) {
        gagal.push({
          baris: offset + i + 1,
          error: e instanceof Error ? e.message : 'Data tidak valid',
        });
      }
    }
    return { ok, gagal };
  } catch (err) {
    handleDbError('importDbProducts', err);
  }
}

export async function getDbMaster(typeInput: unknown): Promise<MasterItem[]> {
  const type = String(typeInput || '').trim() as MasterType;
  if (!VALID_MASTER_TYPES.has(type)) {
    throw new PosDomainError('Tipe master tidak valid');
  }
  try {
    await ensureDefaultMasterSeeded();
    const rows = await db
      .select({ id: masterItems.id, nama: masterItems.nama })
      .from(masterItems)
      .where(eq(masterItems.type, type))
      .orderBy(masterItems.id);
    return rows;
  } catch (err) {
    handleDbError('getDbMaster', err);
  }
}

export async function saveDbMaster(
  typeInput: unknown,
  namaInput: unknown,
  idInput?: unknown,
): Promise<boolean> {
  const type = String(typeInput || '').trim() as MasterType;
  const nama = String(namaInput || '').trim();
  const id = Number(idInput) || 0;
  if (!VALID_MASTER_TYPES.has(type) || !nama) {
    throw new PosDomainError('Nama wajib diisi');
  }

  try {
    const existing = await db
      .select()
      .from(masterItems)
      .where(eq(masterItems.type, type));
    if (
      existing.some(
        (x) => x.nama.toLowerCase() === nama.toLowerCase() && x.id !== id,
      )
    ) {
      throw new PosDomainError(`"${nama}" sudah ada`, 409);
    }

    if (id > 0) {
      const updated = await db
        .update(masterItems)
        .set({ nama })
        .where(and(eq(masterItems.id, id), eq(masterItems.type, type)))
        .returning({ id: masterItems.id });
      if (!updated[0]) throw new PosDomainError('Data tidak ditemukan', 404);
    } else {
      await db.insert(masterItems).values({ type, nama });
    }
    return true;
  } catch (err) {
    handleDbError('saveDbMaster', err);
  }
}

export async function deleteDbMaster(typeInput: unknown, idInput: unknown): Promise<boolean> {
  const type = String(typeInput || '').trim() as MasterType;
  const id = Number(idInput) || 0;
  if (!VALID_MASTER_TYPES.has(type) || id <= 0) {
    throw new PosDomainError('Data tidak ditemukan', 404);
  }

  try {
    const targetRows = await db
      .select()
      .from(masterItems)
      .where(and(eq(masterItems.id, id), eq(masterItems.type, type)))
      .limit(1);
    const target = targetRows[0];
    if (!target) throw new PosDomainError('Data tidak ditemukan', 404);

    if (type === 'kategori') {
      const used = await db
        .select({ id: products.id })
        .from(products)
        .where(eq(products.kategori, target.nama))
        .limit(1);
      if (used[0]) throw new PosDomainError(`“${target.nama}” masih dipakai, tidak bisa dihapus`, 409);
    } else if (type === 'tipe') {
      const used = await db
        .select({ id: products.id })
        .from(products)
        .where(eq(products.tipe, target.nama))
        .limit(1);
      if (used[0]) throw new PosDomainError(`“${target.nama}” masih dipakai, tidak bisa dihapus`, 409);
    } else if (type === 'satuan') {
      const used = await db
        .select({ id: products.id })
        .from(products)
        .where(eq(products.satuan, target.nama))
        .limit(1);
      if (used[0]) throw new PosDomainError(`“${target.nama}” masih dipakai, tidak bisa dihapus`, 409);
    } else if (type === 'supplier') {
      const used = await db
        .select({ id: products.id })
        .from(products)
        .where(eq(products.supplier, target.nama))
        .limit(1);
      if (used[0]) throw new PosDomainError(`“${target.nama}” masih dipakai, tidak bisa dihapus`, 409);
    } else if (type === 'konsumen') {
      const used = await db
        .select({ id: transactions.id })
        .from(transactions)
        .where(and(eq(transactions.kind, 'sales'), eq(transactions.party, target.nama)))
        .limit(1);
      if (used[0]) throw new PosDomainError(`“${target.nama}” masih dipakai, tidak bisa dihapus`, 409);
    }

    await db.delete(masterItems).where(eq(masterItems.id, target.id));
    return true;
  } catch (err) {
    handleDbError('deleteDbMaster', err);
  }
}

export async function saveDbTransaction(
  kind: 'sales' | 'purchase',
  data: Record<string, unknown>,
  user: DbUserRecord,
): Promise<TransactionNote> {
  const reqId = String(data.requestId || '').trim();
  const rawItems = Array.isArray(data.items) ? (data.items as Record<string, unknown>[]) : [];
  if (!rawItems.length) throw new PosDomainError('Keranjang kosong');
  if (data.updateHpp && user.role !== 'owner') {
    throw new PosDomainError('Hanya owner yang boleh memperbarui HPP', 403);
  }

  const tgl = /^\d{4}-\d{2}-\d{2}$/.test(String(data.tgl || ''))
    ? String(data.tgl)
    : isoDate();
  const partyField = kind === 'sales' ? 'konsumen' : 'supplier';
  const party = String(data[partyField] || (kind === 'sales' ? 'Umum' : '')).trim();

  try {
    return await db.transaction(async (tx) => {
      if (reqId) {
        const existingTx = await tx
          .select()
          .from(transactions)
          .where(eq(transactions.requestId, reqId))
          .limit(1);
        if (existingTx[0]) {
          const existingItems = await tx
            .select()
            .from(transactionItems)
            .where(eq(transactionItems.transactionId, existingTx[0].id))
            .orderBy(transactionItems.id);
          return mapTransactionRow(existingTx[0], existingItems);
        }
      }

      const codes = Array.from(
        new Set(rawItems.map((it) => String(it.kode || '').trim()).filter(Boolean)),
      );
      if (!codes.length) throw new PosDomainError('Produk tidak valid');

      const lockedProducts = await tx
        .select()
        .from(products)
        .where(inArray(products.kode, codes))
        .for('update');
      const productMap = new Map(lockedProducts.map((p) => [p.kode, p]));

      const needByKode = new Map<string, number>();
      const preparedItems = rawItems.map((it) => {
        const kode = String(it.kode || '').trim();
        const p = productMap.get(kode);
        if (!p) throw new PosDomainError(`Produk ${kode} tidak ditemukan`, 404);
        const qty = Math.floor(Number(it.qty));
        if (!(qty > 0)) throw new PosDomainError(`Qty tidak valid untuk ${p.nama}`);
        const harga = Math.round(num(it.harga));
        const gross = harga * qty;
        const dr = Math.min(
          gross,
          num(it.diskon_rp) + (gross * Math.min(100, num(it.diskon_persen))) / 100,
        );
        needByKode.set(p.kode, (needByKode.get(p.kode) || 0) + qty);
        return {
          kode: p.kode,
          nama: p.nama,
          harga,
          qty,
          satuan: p.satuan || 'Pcs',
          diskonRp: Math.round(dr),
          subtotal: Math.round(gross - dr),
          cost: p.hpp || 0,
        };
      });

      if (kind === 'sales') {
        for (const [kode, needed] of needByKode.entries()) {
          const p = productMap.get(kode);
          if (p && !p.jasa && p.stok < needed) {
            throw new PosDomainError(`Stok ${p.nama} tidak cukup (sisa ${p.stok})`);
          }
        }
      }

      const subtotal = preparedItems.reduce((a, i) => a + i.subtotal, 0);
      const diskon = Math.min(
        subtotal,
        Math.round(
          (subtotal * Math.min(100, num(data.diskon_persen))) / 100 + num(data.diskon_rp),
        ),
      );
      const tempoHari = Math.floor(num(data.tempo_hari));
      const tempoDate = new Date(`${tgl}T00:00:00`);
      tempoDate.setDate(tempoDate.getDate() + tempoHari);

      // Generate daily invoice number atomically inside transaction
      const prefix = tgl.slice(2).replace(/-/g, '');
      const sameDayTxs = await tx
        .select({ no: transactions.no })
        .from(transactions)
        .where(and(eq(transactions.kind, kind), eq(transactions.tgl, tgl)));
      const maxSeq = sameDayTxs.reduce((max, row) => {
        if (!row.no.startsWith(prefix)) return max;
        const seq = Number(row.no.slice(6));
        return Number.isFinite(seq) && seq > max ? seq : max;
      }, 0);
      const no = `${prefix}${String(maxSeq + 1).padStart(4, '0')}`;

      const hppTotal = preparedItems.reduce((a, i) => a + i.cost * i.qty, 0);

      const insertedTx = await tx
        .insert(transactions)
        .values({
          kind,
          no,
          tgl,
          party,
          noBukti: String(data.no_bukti || '').trim(),
          tempoHari,
          tempoTgl: tempoHari ? isoDate(tempoDate) : '',
          diskonPersen: num(data.diskon_persen),
          diskonRp: Math.round(num(data.diskon_rp)),
          subtotal,
          diskon,
          total: subtotal - diskon,
          keterangan: String(data.keterangan || '').trim(),
          kasir: user.username || user.email,
          userId: user.id,
          batal: false,
          alasan: '',
          hppTotal,
          requestId: reqId || null,
        })
        .returning();

      const txRow = insertedTx[0];
      const insertedItems = await tx
        .insert(transactionItems)
        .values(
          preparedItems.map((it) => ({
            transactionId: txRow.id,
            kode: it.kode,
            nama: it.nama,
            harga: it.harga,
            qty: it.qty,
            satuan: it.satuan,
            diskonRp: it.diskonRp,
            subtotal: it.subtotal,
          })),
        )
        .returning();

      for (const [kode, qtyTotal] of needByKode.entries()) {
        const p = productMap.get(kode);
        if (!p || p.jasa) continue;
        const nextStok = kind === 'sales' ? p.stok - qtyTotal : p.stok + qtyTotal;
        let nextHpp = p.hpp;
        if (kind === 'purchase' && data.updateHpp) {
          const lastMatch = [...preparedItems].reverse().find((it) => it.kode === kode);
          if (lastMatch) nextHpp = lastMatch.harga;
        }
        await tx
          .update(products)
          .set({ stok: nextStok, hpp: nextHpp, updatedAt: new Date() })
          .where(eq(products.id, p.id));
      }

      return mapTransactionRow(txRow, insertedItems);
    });
  } catch (err) {
    handleDbError('saveDbTransaction', err);
  }
}

export async function cancelDbTransaction(
  kind: 'sales' | 'purchase',
  noInput: unknown,
  alasanInput: unknown,
): Promise<boolean> {
  const no = String(noInput || '').trim();
  const alasan = String(alasanInput || '').trim();
  if (!no) throw new PosDomainError('No. nota wajib diisi');
  if (!alasan) throw new PosDomainError('Alasan pembatalan wajib diisi');

  try {
    return await db.transaction(async (tx) => {
      const found = await tx
        .select()
        .from(transactions)
        .where(and(eq(transactions.kind, kind), eq(transactions.no, no)))
        .for('update')
        .limit(1);
      const note = found[0];
      if (!note) throw new PosDomainError('Nota tidak ditemukan', 404);
      if (note.batal) throw new PosDomainError('Nota sudah dibatalkan');

      const items = await tx
        .select()
        .from(transactionItems)
        .where(eq(transactionItems.transactionId, note.id));

      const codes = Array.from(new Set(items.map((i) => i.kode)));
      if (codes.length > 0) {
        const lockedProducts = await tx
          .select()
          .from(products)
          .where(inArray(products.kode, codes))
          .for('update');
        const productMap = new Map(lockedProducts.map((p) => [p.kode, p]));

        const qtyByKode = new Map<string, number>();
        for (const it of items) {
          qtyByKode.set(it.kode, (qtyByKode.get(it.kode) || 0) + it.qty);
        }

        if (kind === 'purchase') {
          for (const [kode, qty] of qtyByKode.entries()) {
            const p = productMap.get(kode);
            if (p && !p.jasa && p.stok < qty) {
              throw new PosDomainError(
                `Stok ${p.nama} sudah terpakai, pembelian tidak bisa dibatalkan`,
              );
            }
          }
        }

        for (const [kode, qty] of qtyByKode.entries()) {
          const p = productMap.get(kode);
          if (!p || p.jasa) continue;
          const nextStok = kind === 'sales' ? p.stok + qty : p.stok - qty;
          await tx
            .update(products)
            .set({ stok: nextStok, updatedAt: new Date() })
            .where(eq(products.id, p.id));
        }
      }

      await tx
        .update(transactions)
        .set({ batal: true, alasan })
        .where(eq(transactions.id, note.id));
      return true;
    });
  } catch (err) {
    handleDbError('cancelDbTransaction', err);
  }
}

export async function getDbTransactionsByDate(
  kind: 'sales' | 'purchase',
  tglInput: unknown,
): Promise<TransactionSummary[]> {
  const tgl = String(tglInput || '').trim() || isoDate();
  try {
    const rows = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.kind, kind), eq(transactions.tgl, tgl)))
      .orderBy(desc(transactions.id));
    return rows.map((x) => ({
      no: x.no,
      tgl: x.tgl,
      pihak: x.party || '-',
      total: x.total,
      batal: x.batal,
    }));
  } catch (err) {
    handleDbError('getDbTransactionsByDate', err);
  }
}

export async function getDbGlobalSearchTransactions(
  allowedKinds: ('sales' | 'purchase')[],
  limitCount = 600,
): Promise<GlobalTransactionSearchItem[]> {
  if (allowedKinds.length === 0) return [];
  const safeLimit = Math.min(1000, Math.max(50, Math.floor(limitCount)));
  try {
    const rows = await db
      .select({
        kind: transactions.kind,
        no: transactions.no,
        tgl: transactions.tgl,
        party: transactions.party,
        noBukti: transactions.noBukti,
        keterangan: transactions.keterangan,
        kasir: transactions.kasir,
        total: transactions.total,
        batal: transactions.batal,
      })
      .from(transactions)
      .where(inArray(transactions.kind, allowedKinds))
      .orderBy(desc(transactions.id))
      .limit(safeLimit);

    return rows.map((x) => ({
      kind: x.kind === 'purchase' ? 'purchase' : 'sales',
      no: x.no,
      tgl: x.tgl,
      pihak: x.party || '-',
      no_bukti: x.noBukti || '',
      keterangan: x.keterangan || '',
      kasir: x.kasir || '-',
      total: x.total,
      batal: x.batal,
    }));
  } catch (err) {
    handleDbError('getDbGlobalSearchTransactions', err);
  }
}

export async function getDbTransactionNote(
  kind: 'sales' | 'purchase',
  noInput: unknown,
): Promise<TransactionNote> {
  const no = String(noInput || '').trim();
  if (!no) throw new PosDomainError('No. nota wajib diisi');
  try {
    const found = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.kind, kind), eq(transactions.no, no)))
      .limit(1);
    if (!found[0]) throw new PosDomainError('Nota tidak ditemukan', 404);
    const items = await db
      .select()
      .from(transactionItems)
      .where(eq(transactionItems.transactionId, found[0].id))
      .orderBy(transactionItems.id);
    return mapTransactionRow(found[0], items);
  } catch (err) {
    handleDbError('getDbTransactionNote', err);
  }
}

export async function getDbExpenses(dari?: unknown, sampai?: unknown): Promise<Expense[]> {
  const d1 = String(dari || '').trim();
  const d2 = String(sampai || '').trim();
  const conditions = [];
  if (d1) conditions.push(gte(expenses.tgl, d1));
  if (d2) conditions.push(lte(expenses.tgl, d2));

  try {
    const rows = await db
      .select()
      .from(expenses)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(expenses.tgl), desc(expenses.id));
    return rows.map((e) => ({
      nomor: e.nomor,
      tgl: e.tgl,
      kategori: e.kategori,
      keterangan: e.keterangan,
      jumlah: e.jumlah,
      user: e.username,
    }));
  } catch (err) {
    handleDbError('getDbExpenses', err);
  }
}

export async function saveDbExpense(
  data: Record<string, unknown>,
  user: DbUserRecord,
): Promise<boolean> {
  const jumlah = Math.round(num(data.jumlah));
  const kategori = String(data.kategori || '').trim();
  const keterangan = String(data.keterangan || '').trim();
  if (!kategori) throw new PosDomainError('Kategori wajib diisi');
  if (!(jumlah > 0)) throw new PosDomainError('Jumlah harus lebih dari 0');

  const tgl = /^\d{4}-\d{2}-\d{2}$/.test(String(data.tgl || ''))
    ? String(data.tgl)
    : isoDate();
  const existingNomor = String(data.nomor || '').trim();

  try {
    if (existingNomor) {
      const updated = await db
        .update(expenses)
        .set({ tgl, kategori, keterangan, jumlah })
        .where(eq(expenses.nomor, existingNomor))
        .returning({ id: expenses.id });
      if (!updated[0]) throw new PosDomainError('Biaya tidak ditemukan', 404);
      return true;
    }

    await db.transaction(async (tx) => {
      const last = await tx
        .select({ id: expenses.id, nomor: expenses.nomor })
        .from(expenses)
        .orderBy(desc(expenses.id))
        .limit(1);
      const lastSeq = last[0]?.nomor ? Number(last[0].nomor.replace(/^B/i, '')) || last[0].id : 0;
      const nomor = `B${String(lastSeq + 1).padStart(5, '0')}`;
      await tx.insert(expenses).values({
        nomor,
        tgl,
        kategori,
        keterangan,
        jumlah,
        username: user.username || user.email,
        userId: user.id,
      });
    });
    return true;
  } catch (err) {
    handleDbError('saveDbExpense', err);
  }
}

export async function deleteDbExpense(nomorInput: unknown): Promise<boolean> {
  const nomor = String(nomorInput || '').trim();
  if (!nomor) throw new PosDomainError('Nomor biaya wajib diisi');
  try {
    const deleted = await db
      .delete(expenses)
      .where(eq(expenses.nomor, nomor))
      .returning({ id: expenses.id });
    if (!deleted[0]) throw new PosDomainError('Biaya tidak ditemukan', 404);
    return true;
  } catch (err) {
    handleDbError('deleteDbExpense', err);
  }
}

const SALES_GROUP_ORDER: SalesGroupKey[] = [
  'LCD',
  'Sparepart',
  'Aksesoris',
  'Jasa Service',
  'Lainnya',
];

const SALES_GROUP_LABEL: Record<SalesGroupKey, string> = {
  LCD: 'Penjualan LCD',
  Sparepart: 'Penjualan Sparepart',
  Aksesoris: 'Penjualan Aksesoris',
  'Jasa Service': 'Jasa Service',
  Lainnya: 'Lainnya',
};

function classifySalesGroup(kategori: string, nama: string, isJasa: boolean): SalesGroupKey {
  const kat = kategori.trim().toLowerCase();
  const nm = nama.trim().toLowerCase();

  // 1) Jasa / Service (check service flags & category/prefix before hardware keywords like "Jasa Pasang LCD")
  if (
    isJasa ||
    /\b(jasa|service|servis|ongkos|pasang|flash|software|bongkar|repair)\b/.test(kat) ||
    /^(jasa|service|servis|ongkos)\b/.test(nm)
  ) {
    return 'Jasa Service';
  }

  // 2) LCD & Touchscreen
  if (
    /\b(lcd|touchscreen|touch\s*screen|layar|oled|amoled|super\s*amoled|incell)\b/.test(kat) ||
    /\b(lcd|lcd\+ts|touchscreen|touch\s*screen)\b/.test(nm)
  ) {
    return 'LCD';
  }

  // 3) Sparepart (internal phone repair components, check before "charger" accessory keyword so "konektor charger" goes here)
  const sparepartPattern =
    /\b(sparepart|spare\s*part|sperpart|part|baterai|battery|batre|batrai|flexibel|flexible|flex|konektor|connector|papan\s*cas|sub\s*board|pcb|speaker|buzzer|mic|mik|kamera|camera|backdoor|back\s*door|bezel|frame|tulang|sim\s*tray|simtray|tombol|on\s*off|volume|fingerprint|finger\s*print|ic|emmc|cpu|mesin|antena|antenna|vibrator|getar|kaca\s*kamera|lens\s*kamera|lem\s*lcd|t7000|b7000|e8000|flux|timah)\b/;
  if (sparepartPattern.test(kat) || sparepartPattern.test(nm)) {
    return 'Sparepart';
  }

  // 4) Aksesoris
  const aksesorisPattern =
    /\b(aksesoris|accessories|accessory|garskin|casing|case|softcase|hardcase|charger|adaptor|adapter|kabel|cable|tempered\s*glass|tg|anti\s*gores|antigores|earphone|headset|headphone|tws|powerbank|power\s*bank|holder|tripod|memori|memory|sd\s*card|flashdisk|flash\s*disk|otg|bluetooth|smartwatch|strap|ring|popsocket|pelindung)\b/;
  if (aksesorisPattern.test(kat) || aksesorisPattern.test(nm)) {
    return 'Aksesoris';
  }

  return 'Lainnya';
}

export async function reportDbSalesOrPurchases(
  kind: 'sales' | 'purchase',
  dari?: unknown,
  sampai?: unknown,
) {
  const d1 = String(dari || '').trim();
  const d2 = String(sampai || '').trim();
  const conditions = [eq(transactions.kind, kind), eq(transactions.batal, false)];
  if (d1) conditions.push(gte(transactions.tgl, d1));
  if (d2) conditions.push(lte(transactions.tgl, d2));

  try {
    const rows = await db
      .select({
        id: transactions.id,
        no: transactions.no,
        tgl: transactions.tgl,
        party: transactions.party,
        subtotal: transactions.subtotal,
        diskon: transactions.diskon,
        total: transactions.total,
      })
      .from(transactions)
      .where(and(...conditions))
      .orderBy(transactions.tgl, transactions.id);

    if (kind === 'purchase') {
      return {
        rows: rows.map((r) => ({
          no: r.no,
          tgl: r.tgl,
          pihak: r.party || '-',
          total: r.total,
        })),
      };
    }

    if (rows.length === 0) {
      return {
        rows: [],
        salesGroups: SALES_GROUP_ORDER.filter((g) => g !== 'Lainnya' && g !== 'Jasa Service').map(
          (g) => ({
            group: g,
            label: SALES_GROUP_LABEL[g],
            qty: 0,
            notaCount: 0,
            omset: 0,
            categories: [],
          }),
        ),
        salesCategories: [] as SalesCategorySummary[],
        salesTrend: [] as SalesTrendPoint[],
      };
    }

    const txIds = rows.map((r) => r.id);
    const items = await db
      .select({
        transactionId: transactionItems.transactionId,
        kode: transactionItems.kode,
        nama: transactionItems.nama,
        qty: transactionItems.qty,
        subtotal: transactionItems.subtotal,
      })
      .from(transactionItems)
      .where(inArray(transactionItems.transactionId, txIds));

    const kodes = Array.from(new Set(items.map((it) => it.kode).filter(Boolean)));
    const prodMetaMap = new Map<string, { kategori: string; nama: string; jasa: boolean }>();
    if (kodes.length > 0) {
      const prodRows = await db
        .select({
          kode: products.kode,
          nama: products.nama,
          kategori: products.kategori,
          jasa: products.jasa,
        })
        .from(products)
        .where(inArray(products.kode, kodes));
      for (const p of prodRows) {
        prodMetaMap.set(p.kode, {
          kategori: p.kategori || '',
          nama: p.nama || '',
          jasa: Boolean(p.jasa),
        });
      }
    }

    const itemsByTx = new Map<number, typeof items>();
    for (const it of items) {
      const list = itemsByTx.get(it.transactionId) || [];
      list.push(it);
      itemsByTx.set(it.transactionId, list);
    }

    const groupStats = new Map<
      SalesGroupKey,
      { qty: number; notaIds: Set<number>; omset: number; categories: Set<string> }
    >();
    for (const g of SALES_GROUP_ORDER) {
      groupStats.set(g, { qty: 0, notaIds: new Set<number>(), omset: 0, categories: new Set() });
    }

    const catStats = new Map<
      string,
      { kategori: string; group: SalesGroupKey; qty: number; notaIds: Set<number>; omset: number }
    >();

    const txGroupLabels = new Map<number, string>();
    const trendByDate = new Map<string, SalesTrendPoint>();
    const ensureTrendDay = (tgl: string): SalesTrendPoint => {
      let day = trendByDate.get(tgl);
      if (!day) {
        day = {
          tgl,
          LCD: 0,
          Sparepart: 0,
          Aksesoris: 0,
          'Jasa Service': 0,
          Lainnya: 0,
          total: 0,
        };
        trendByDate.set(tgl, day);
      }
      return day;
    };

    for (const tx of rows) {
      const dayPoint = ensureTrendDay(tx.tgl);
      const txItems = itemsByTx.get(tx.id) || [];
      if (txItems.length === 0) {
        if (tx.total !== 0) {
          const fallback = groupStats.get('Lainnya')!;
          fallback.notaIds.add(tx.id);
          fallback.omset += tx.total;
          dayPoint.Lainnya += tx.total;
          dayPoint.total += tx.total;
        }
        txGroupLabels.set(tx.id, '-');
        continue;
      }

      const txGroupRevenue = new Map<SalesGroupKey, number>();
      const rawSubtotal = txItems.reduce((sum, it) => sum + (it.subtotal || 0), 0);
      let allocated = 0;

      txItems.forEach((it, idx) => {
        const meta = prodMetaMap.get(it.kode);
        const kategori = (meta?.kategori || '').trim();
        const isJasa = meta?.jasa ?? false;
        const group = classifySalesGroup(kategori, it.nama || meta?.nama || '', isJasa);

        // Allocate invoice-level discounts proportionally so group revenues sum cleanly to tx.total
        let netAmount: number;
        if (idx === txItems.length - 1) {
          netAmount = tx.total - allocated;
        } else if (rawSubtotal > 0 && tx.diskon > 0) {
          netAmount = Math.round((it.subtotal * tx.total) / rawSubtotal);
        } else {
          netAmount = it.subtotal;
        }
        allocated += netAmount;

        const gEntry = groupStats.get(group)!;
        gEntry.qty += it.qty;
        gEntry.notaIds.add(tx.id);
        gEntry.omset += netAmount;
        if (kategori) gEntry.categories.add(kategori);

        dayPoint[group] += netAmount;
        dayPoint.total += netAmount;

        const catLabel = kategori || (isJasa ? 'Jasa Service' : 'Tanpa Kategori');
        const catKey = `${group}::${catLabel.toLowerCase()}`;
        const existingCat = catStats.get(catKey);
        if (existingCat) {
          existingCat.qty += it.qty;
          existingCat.notaIds.add(tx.id);
          existingCat.omset += netAmount;
        } else {
          catStats.set(catKey, {
            kategori: catLabel,
            group,
            qty: it.qty,
            notaIds: new Set([tx.id]),
            omset: netAmount,
          });
        }

        txGroupRevenue.set(group, (txGroupRevenue.get(group) || 0) + netAmount);
      });

      const sortedGroups = Array.from(txGroupRevenue.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([g]) => g);
      txGroupLabels.set(tx.id, sortedGroups.length > 0 ? sortedGroups.join(', ') : '-');
    }

    const salesGroups: SalesGroupSummary[] = SALES_GROUP_ORDER.filter((g) => {
      const stat = groupStats.get(g)!;
      if (g === 'LCD' || g === 'Sparepart' || g === 'Aksesoris') return true;
      return stat.omset > 0 || stat.qty > 0;
    }).map((g) => {
      const stat = groupStats.get(g)!;
      return {
        group: g,
        label: SALES_GROUP_LABEL[g],
        qty: stat.qty,
        notaCount: stat.notaIds.size,
        omset: stat.omset,
        categories: Array.from(stat.categories).sort(),
      };
    });

    const salesCategories: SalesCategorySummary[] = Array.from(catStats.values())
      .sort((a, b) => b.omset - a.omset)
      .map((c) => ({
        kategori: c.kategori,
        group: c.group,
        qty: c.qty,
        notaCount: c.notaIds.size,
        omset: c.omset,
      }));

    const salesTrend: SalesTrendPoint[] = Array.from(trendByDate.values()).sort((a, b) =>
      a.tgl.localeCompare(b.tgl),
    );

    return {
      rows: rows.map((r) => ({
        no: r.no,
        tgl: r.tgl,
        pihak: r.party || 'Umum',
        kelompok: txGroupLabels.get(r.id) || '-',
        total: r.total,
      })),
      salesGroups,
      salesCategories,
      salesTrend,
    };
  } catch (err) {
    handleDbError('reportDbSalesOrPurchases', err);
  }
}

const MONTH_SHORT_ID = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'Mei',
  'Jun',
  'Jul',
  'Agu',
  'Sep',
  'Okt',
  'Nov',
  'Des',
];

const MONTH_FULL_ID = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];

function shiftYearMonth(ym: string, deltaMonths: number): string {
  const [yStr, mStr] = ym.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  const totalMonths = y * 12 + (m - 1) + deltaMonths;
  const nextY = Math.floor(totalMonths / 12);
  const nextM = ((totalMonths % 12) + 12) % 12;
  return `${nextY}-${String(nextM + 1).padStart(2, '0')}`;
}

function getDaysInYearMonth(ym: string): number {
  const [yStr, mStr] = ym.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  return new Date(y, m, 0).getDate();
}

function formatYearMonthShort(ym: string): string {
  const [yStr, mStr] = ym.split('-');
  const mIdx = Number(mStr) - 1;
  return `${MONTH_SHORT_ID[mIdx] || mStr} ${yStr.slice(2)}`;
}

function formatYearMonthFull(ym: string): string {
  const [yStr, mStr] = ym.split('-');
  const mIdx = Number(mStr) - 1;
  return `${MONTH_FULL_ID[mIdx] || mStr} ${yStr}`;
}

function calcGrowthPct(current: number, previous: number): number | null {
  if (previous <= 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export async function reportDbSalesComparison(
  bulanInput?: unknown,
  monthsInput?: unknown,
): Promise<SalesMomComparison> {
  const { date: todayWib } = getWibDateAndTime();
  const currentYm = todayWib.slice(0, 7);
  const rawBulan = String(bulanInput || '').trim();
  const selectedYm = /^\d{4}-(0[1-9]|1[0-2])$/.test(rawBulan) ? rawBulan : currentYm;

  const parsedMonths = Math.round(Number(monthsInput) || 6);
  const monthsCount = Math.min(12, Math.max(2, parsedMonths));

  const previousYm = shiftYearMonth(selectedYm, -1);
  // Query 1 extra month before the visible window so the oldest month also gets an accurate MoM growthPct
  const earliestYm = shiftYearMonth(selectedYm, -monthsCount);
  const earliestStart = `${earliestYm}-01`;
  const selectedEndDay = getDaysInYearMonth(selectedYm);
  const selectedEnd = `${selectedYm}-${String(selectedEndDay).padStart(2, '0')}`;

  const visibleYms: string[] = [];
  for (let i = monthsCount - 1; i >= 0; i--) {
    visibleYms.push(shiftYearMonth(selectedYm, -i));
  }
  const allNeededYms = [earliestYm, ...visibleYms];

  interface MonthBucket {
    omset: number;
    notaCount: number;
    qtyCount: number;
    groups: Record<SalesGroupKey, number>;
    groupQty: Record<SalesGroupKey, number>;
    dailyOmset: Map<number, number>;
    dailyNota: Map<number, number>;
  }

  const buckets = new Map<string, MonthBucket>();
  for (const ym of allNeededYms) {
    buckets.set(ym, {
      omset: 0,
      notaCount: 0,
      qtyCount: 0,
      groups: {
        LCD: 0,
        Sparepart: 0,
        Aksesoris: 0,
        'Jasa Service': 0,
        Lainnya: 0,
      },
      groupQty: {
        LCD: 0,
        Sparepart: 0,
        Aksesoris: 0,
        'Jasa Service': 0,
        Lainnya: 0,
      },
      dailyOmset: new Map(),
      dailyNota: new Map(),
    });
  }

  try {
    const txRows = await db
      .select({
        id: transactions.id,
        tgl: transactions.tgl,
        diskon: transactions.diskon,
        total: transactions.total,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.kind, 'sales'),
          eq(transactions.batal, false),
          gte(transactions.tgl, earliestStart),
          lte(transactions.tgl, selectedEnd),
        ),
      )
      .orderBy(transactions.tgl, transactions.id);

    const txIds = txRows.map((t) => t.id);
    const items =
      txIds.length > 0
        ? await db
            .select({
              transactionId: transactionItems.transactionId,
              kode: transactionItems.kode,
              nama: transactionItems.nama,
              qty: transactionItems.qty,
              subtotal: transactionItems.subtotal,
            })
            .from(transactionItems)
            .where(inArray(transactionItems.transactionId, txIds))
        : [];

    const kodes = Array.from(new Set(items.map((it) => it.kode).filter(Boolean)));
    const prodMetaMap = new Map<string, { kategori: string; nama: string; jasa: boolean }>();
    if (kodes.length > 0) {
      const prodRows = await db
        .select({
          kode: products.kode,
          nama: products.nama,
          kategori: products.kategori,
          jasa: products.jasa,
        })
        .from(products)
        .where(inArray(products.kode, kodes));
      for (const p of prodRows) {
        prodMetaMap.set(p.kode, {
          kategori: p.kategori || '',
          nama: p.nama || '',
          jasa: Boolean(p.jasa),
        });
      }
    }

    const itemsByTx = new Map<number, typeof items>();
    for (const it of items) {
      const list = itemsByTx.get(it.transactionId) || [];
      list.push(it);
      itemsByTx.set(it.transactionId, list);
    }

    for (const tx of txRows) {
      const ym = tx.tgl.slice(0, 7);
      const dayNum = Number(tx.tgl.slice(8, 10));
      const bucket = buckets.get(ym);
      if (!bucket) continue;

      bucket.omset += tx.total;
      bucket.notaCount += 1;
      if (Number.isFinite(dayNum) && dayNum >= 1 && dayNum <= 31) {
        bucket.dailyOmset.set(dayNum, (bucket.dailyOmset.get(dayNum) || 0) + tx.total);
        bucket.dailyNota.set(dayNum, (bucket.dailyNota.get(dayNum) || 0) + 1);
      }

      const txItems = itemsByTx.get(tx.id) || [];
      if (txItems.length === 0) {
        bucket.groups.Lainnya += tx.total;
        continue;
      }

      const rawSubtotal = txItems.reduce((sum, it) => sum + (it.subtotal || 0), 0);
      let allocated = 0;

      txItems.forEach((it, idx) => {
        const meta = prodMetaMap.get(it.kode);
        const kategori = (meta?.kategori || '').trim();
        const isJasa = meta?.jasa ?? false;
        const group = classifySalesGroup(kategori, it.nama || meta?.nama || '', isJasa);

        let netAmount: number;
        if (idx === txItems.length - 1) {
          netAmount = tx.total - allocated;
        } else if (rawSubtotal > 0 && tx.diskon > 0) {
          netAmount = Math.round((it.subtotal * tx.total) / rawSubtotal);
        } else {
          netAmount = it.subtotal;
        }
        allocated += netAmount;

        bucket.qtyCount += it.qty;
        bucket.groups[group] += netAmount;
        bucket.groupQty[group] += it.qty;
      });
    }

    const buildMetric = (ym: string, prevYm: string): MonthlySalesMetric => {
      const b = buckets.get(ym)!;
      const prevB = buckets.get(prevYm);
      const prevOmset = prevB ? prevB.omset : 0;
      const omsetDelta = b.omset - prevOmset;
      return {
        ym,
        label: formatYearMonthShort(ym),
        fullLabel: formatYearMonthFull(ym),
        omset: b.omset,
        prevOmset,
        omsetDelta,
        growthPct: prevB ? calcGrowthPct(b.omset, prevOmset) : null,
        notaCount: b.notaCount,
        qtyCount: b.qtyCount,
        avgNota: b.notaCount > 0 ? Math.round(b.omset / b.notaCount) : 0,
        LCD: b.groups.LCD,
        Sparepart: b.groups.Sparepart,
        Aksesoris: b.groups.Aksesoris,
        'Jasa Service': b.groups['Jasa Service'],
        Lainnya: b.groups.Lainnya,
      };
    };

    const series = visibleYms.map((ym) => buildMetric(ym, shiftYearMonth(ym, -1)));
    const selectedMetric = series[series.length - 1];
    const previousMetric = series[series.length - 2] || buildMetric(previousYm, shiftYearMonth(previousYm, -1));

    const selectedBucket = buckets.get(selectedYm)!;
    const prevBucket = buckets.get(previousYm)!;

    const groupComparison: SalesGroupMomSummary[] = SALES_GROUP_ORDER.filter((g) => {
      if (g === 'LCD' || g === 'Sparepart' || g === 'Aksesoris') return true;
      return selectedBucket.groups[g] > 0 || prevBucket.groups[g] > 0;
    }).map((g) => {
      const curr = selectedBucket.groups[g];
      const prev = prevBucket.groups[g];
      return {
        group: g,
        label: SALES_GROUP_LABEL[g],
        currentOmset: curr,
        previousOmset: prev,
        delta: curr - prev,
        growthPct: calcGrowthPct(curr, prev),
        currentQty: selectedBucket.groupQty[g],
        previousQty: prevBucket.groupQty[g],
      };
    });

    const isCurrentMonth = selectedYm === currentYm;
    const todayDay = Number(todayWib.slice(8, 10));
    const prevDaysCount = getDaysInYearMonth(previousYm);
    const maxDayAxis = Math.max(selectedEndDay, prevDaysCount);
    const currentCutoffDay = isCurrentMonth ? Math.min(todayDay, selectedEndDay) : selectedEndDay;

    const dailyCumulative: DailyCumulativePoint[] = [];
    let runningCurr = 0;
    let runningPrev = 0;
    for (let d = 1; d <= maxDayAxis; d++) {
      const hasCurr = d <= currentCutoffDay;
      const hasPrev = d <= prevDaysCount;
      const cDaily = hasCurr ? selectedBucket.dailyOmset.get(d) || 0 : null;
      const pDaily = hasPrev ? prevBucket.dailyOmset.get(d) || 0 : null;
      if (cDaily !== null) runningCurr += cDaily;
      if (pDaily !== null) runningPrev += pDaily;
      dailyCumulative.push({
        day: d,
        label: String(d),
        currentDaily: cDaily,
        currentCum: hasCurr ? runningCurr : null,
        prevDaily: pDaily,
        prevCum: hasPrev ? runningPrev : null,
      });
    }

    let mtdSummary: SalesMomComparison['mtdSummary'] = null;
    if (isCurrentMonth && todayDay >= 1) {
      let currMtdOmset = 0;
      let prevMtdOmset = 0;
      let currMtdNota = 0;
      let prevMtdNota = 0;
      for (let d = 1; d <= todayDay; d++) {
        currMtdOmset += selectedBucket.dailyOmset.get(d) || 0;
        prevMtdOmset += prevBucket.dailyOmset.get(d) || 0;
        currMtdNota += selectedBucket.dailyNota.get(d) || 0;
        prevMtdNota += prevBucket.dailyNota.get(d) || 0;
      }
      mtdSummary = {
        currentOmset: currMtdOmset,
        previousMtdOmset: prevMtdOmset,
        delta: currMtdOmset - prevMtdOmset,
        growthPct: calcGrowthPct(currMtdOmset, prevMtdOmset),
        currentNota: currMtdNota,
        previousMtdNota: prevMtdNota,
      };
    }

    return {
      selectedYm,
      previousYm,
      selectedLabel: selectedMetric.fullLabel,
      previousLabel: previousMetric.fullLabel,
      isCurrentMonth,
      mtdDay: isCurrentMonth ? todayDay : null,
      mtdSummary,
      selected: selectedMetric,
      previous: previousMetric,
      notaDelta: selectedMetric.notaCount - previousMetric.notaCount,
      notaGrowthPct: calcGrowthPct(selectedMetric.notaCount, previousMetric.notaCount),
      qtyDelta: selectedMetric.qtyCount - previousMetric.qtyCount,
      qtyGrowthPct: calcGrowthPct(selectedMetric.qtyCount, previousMetric.qtyCount),
      avgNotaDelta: selectedMetric.avgNota - previousMetric.avgNota,
      avgNotaGrowthPct: calcGrowthPct(selectedMetric.avgNota, previousMetric.avgNota),
      series,
      groupComparison,
      dailyCumulative,
    };
  } catch (err) {
    handleDbError('reportDbSalesComparison', err);
  }
}

export async function reportDbExpenses(dari?: unknown, sampai?: unknown) {
  const rows = await getDbExpenses(dari, sampai);
  return { rows };
}

export async function reportDbProfit(dari?: unknown, sampai?: unknown) {
  const d1 = String(dari || '').trim();
  const d2 = String(sampai || '').trim();

  const saleCond = [eq(transactions.kind, 'sales'), eq(transactions.batal, false)];
  if (d1) saleCond.push(gte(transactions.tgl, d1));
  if (d2) saleCond.push(lte(transactions.tgl, d2));

  const expCond = [];
  if (d1) expCond.push(gte(expenses.tgl, d1));
  if (d2) expCond.push(lte(expenses.tgl, d2));

  try {
    const [salesRows, expRows] = await Promise.all([
      db
        .select({ total: transactions.total, hppTotal: transactions.hppTotal })
        .from(transactions)
        .where(and(...saleCond)),
      db
        .select({ jumlah: expenses.jumlah })
        .from(expenses)
        .where(expCond.length ? and(...expCond) : undefined),
    ]);
    return {
      penjualan: salesRows.reduce((sum, r) => sum + r.total, 0),
      hpp: salesRows.reduce((sum, r) => sum + r.hppTotal, 0),
      biaya: expRows.reduce((sum, r) => sum + r.jumlah, 0),
    };
  } catch (err) {
    handleDbError('reportDbProfit', err);
  }
}

export async function reportDbStock() {
  try {
    const rows = await db
      .select({
        kode: products.kode,
        nama: products.nama,
        stok: products.stok,
        hpp: products.hpp,
      })
      .from(products)
      .where(eq(products.jasa, false))
      .orderBy(products.id);
    return {
      rows: rows.map((p) => ({
        kode: p.kode,
        nama: p.nama,
        stok: p.stok,
        hpp: p.hpp,
        nilai: p.stok * p.hpp,
      })),
    };
  } catch (err) {
    handleDbError('reportDbStock', err);
  }
}

export async function getDbDashboard(): Promise<DashboardData> {
  const today = isoDate();
  const byDay: Record<string, number> = {};
  for (let i = 6; i >= 0; i--) {
    const dd = new Date();
    dd.setDate(dd.getDate() - i);
    byDay[isoDate(dd)] = 0;
  }
  const sevenDaysAgo = Object.keys(byDay).sort()[0];

  try {
    const [validSales, todayPurchases, todayExpenses, lowProducts, recentSales] =
      await Promise.all([
        db
          .select({
            id: transactions.id,
            tgl: transactions.tgl,
            total: transactions.total,
            hppTotal: transactions.hppTotal,
          })
          .from(transactions)
          .where(and(eq(transactions.kind, 'sales'), eq(transactions.batal, false))),
        db
          .select({ total: transactions.total })
          .from(transactions)
          .where(
            and(
              eq(transactions.kind, 'purchase'),
              eq(transactions.batal, false),
              eq(transactions.tgl, today),
            ),
          ),
        db
          .select({ jumlah: expenses.jumlah })
          .from(expenses)
          .where(eq(expenses.tgl, today)),
        db
          .select({ id: products.id })
          .from(products)
          .where(and(eq(products.jasa, false), lte(products.stok, 3))),
        db
          .select({
            no: transactions.no,
            tgl: transactions.tgl,
            party: transactions.party,
            total: transactions.total,
          })
          .from(transactions)
          .where(and(eq(transactions.kind, 'sales'), eq(transactions.batal, false)))
          .orderBy(desc(transactions.id))
          .limit(6),
      ]);

    let sales = 0;
    let todayTxCount = 0;
    let hpp = 0;
    const validSaleIds: number[] = [];
    for (const s of validSales) {
      validSaleIds.push(s.id);
      if (s.tgl === today) {
        todayTxCount += 1;
        sales += s.total;
        hpp += s.hppTotal;
      }
      if (s.tgl >= sevenDaysAgo && s.tgl in byDay) {
        byDay[s.tgl] += s.total;
      }
    }

    const purch = todayPurchases.reduce((a, x) => a + x.total, 0);
    const exp = todayExpenses.reduce((a, x) => a + x.jumlah, 0);

    const cnt: Record<string, number> = {};
    if (validSaleIds.length > 0) {
      const soldItems = await db
        .select({ nama: transactionItems.nama, qty: transactionItems.qty })
        .from(transactionItems)
        .where(inArray(transactionItems.transactionId, validSaleIds));
      for (const it of soldItems) {
        cnt[it.nama] = (cnt[it.nama] || 0) + it.qty;
      }
    }

    return {
      sales,
      todayTxCount,
      todayHpp: hpp,
      purch,
      exp,
      profit: sales - hpp - exp,
      low: lowProducts.length,
      week: Object.keys(byDay)
        .sort()
        .map((tgl) => ({ tgl, total: byDay[tgl] })),
      recent: recentSales.map((r) => ({
        no: r.no,
        tgl: r.tgl,
        konsumen: r.party || 'Umum',
        total: r.total,
      })),
      top: Object.entries(cnt)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([nama, qty]) => ({ nama, qty })),
    };
  } catch (err) {
    handleDbError('getDbDashboard', err);
  }
}

async function buildSnapshotJson() {
  const [prodRows, txRows, itemRows, expRows, masterRows] = await Promise.all([
    db.select().from(products).orderBy(products.id),
    db.select().from(transactions).orderBy(transactions.id),
    db.select().from(transactionItems).orderBy(transactionItems.id),
    db.select().from(expenses).orderBy(expenses.id),
    db.select().from(masterItems).orderBy(masterItems.id),
  ]);

  const itemsByTx = new Map<number, (typeof transactionItems.$inferSelect)[]>();
  for (const it of itemRows) {
    const arr = itemsByTx.get(it.transactionId) || [];
    arr.push(it);
    itemsByTx.set(it.transactionId, arr);
  }

  const S: TransactionNote[] = [];
  const U: TransactionNote[] = [];
  for (const t of txRows) {
    const mapped = mapTransactionRow(t, itemsByTx.get(t.id) || []);
    if (t.kind === 'sales') S.push(mapped);
    else U.push(mapped);
  }

  const M: Record<MasterType, MasterItem[]> = {
    konsumen: [],
    supplier: [],
    biaya: [],
    kartu: [],
    kategori: [],
    tipe: [],
    satuan: [],
  };
  for (const m of masterRows) {
    const key = m.type as MasterType;
    if (key in M) {
      M[key].push({ id: m.id, nama: m.nama });
    }
  }

  const P = prodRows.map((r) => mapProductRow(r, true));
  const E: Expense[] = expRows.map((e) => ({
    nomor: e.nomor,
    tgl: e.tgl,
    kategori: e.kategori,
    keterangan: e.keterangan,
    jumlah: e.jumlah,
    user: e.username,
  }));

  return {
    P,
    S,
    U,
    E,
    M,
  };
}

export async function createDbBackup(prefix = 'backup'): Promise<BackupRecord> {
  try {
    const snap = await buildSnapshotJson();
    const payload = JSON.stringify(snap);
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    const backupKey = `bk${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    const inserted = await db
      .insert(backups)
      .values({
        backupKey,
        nama: `${prefix}_${stamp}`,
        ukuran: payload.length,
        produk: snap.P.length,
        notaJual: snap.S.length,
        notaBeli: snap.U.length,
        biaya: snap.E.length,
        payload,
      })
      .returning();

    const row = inserted[0];
    return {
      id: row.backupKey,
      nama: row.nama,
      waktu: row.waktu.toISOString(),
      ukuran: row.ukuran,
      url: '',
      produk: row.produk,
      nota_jual: row.notaJual,
      nota_beli: row.notaBeli,
      biaya: row.biaya,
    };
  } catch (err) {
    handleDbError('createDbBackup', err);
  }
}

export async function listDbBackups(limit = 30): Promise<BackupRecord[]> {
  const safeLimit = Math.max(10, Math.min(60, Math.floor(num(limit) || 30)));
  try {
    const rows = await db
      .select({
        backupKey: backups.backupKey,
        nama: backups.nama,
        waktu: backups.waktu,
        ukuran: backups.ukuran,
        produk: backups.produk,
        notaJual: backups.notaJual,
        notaBeli: backups.notaBeli,
        biaya: backups.biaya,
      })
      .from(backups)
      .orderBy(desc(backups.id))
      .limit(safeLimit);
    return rows.map((r) => ({
      id: r.backupKey,
      nama: r.nama,
      waktu: r.waktu.toISOString(),
      ukuran: r.ukuran,
      url: '',
      produk: r.produk,
      nota_jual: r.notaJual,
      nota_beli: r.notaBeli,
      biaya: r.biaya,
    }));
  } catch (err) {
    handleDbError('listDbBackups', err);
  }
}

export async function deleteOldDbBackups(keepCount = 10): Promise<number> {
  const safeKeep = Math.max(5, Math.min(60, Math.floor(num(keepCount) || 10)));
  try {
    const all = await db
      .select({ id: backups.id })
      .from(backups)
      .orderBy(desc(backups.id));
    const toDelete = all.slice(safeKeep).map((b) => b.id);
    if (toDelete.length === 0) return 0;
    await db.delete(backups).where(inArray(backups.id, toDelete));
    return toDelete.length;
  } catch (err) {
    handleDbError('deleteOldDbBackups', err);
  }
}

export async function exportDbBackupById(
  idInput: unknown,
): Promise<{ filename: string; json: string }> {
  const backupKey = String(idInput || '').trim();
  if (!backupKey) throw new PosDomainError('ID backup wajib diisi');
  try {
    const found = await db
      .select({
        nama: backups.nama,
        waktu: backups.waktu,
        payload: backups.payload,
      })
      .from(backups)
      .where(eq(backups.backupKey, backupKey))
      .limit(1);
    if (!found[0]) throw new PosDomainError('Backup tidak ditemukan', 404);
    const parsed = JSON.parse(found[0].payload);
    return {
      filename: `${found[0].nama}.json`,
      json: JSON.stringify({
        version: 1,
        exportedAt: found[0].waktu.toISOString(),
        ...parsed,
      }),
    };
  } catch (err) {
    handleDbError('exportDbBackupById', err);
  }
}

async function applySnapshot(
  parsed: {
    P?: Product[];
    S?: TransactionNote[];
    U?: TransactionNote[];
    E?: Expense[];
    M?: Partial<Record<MasterType, MasterItem[]>>;
  },
  user: DbUserRecord,
) {
  await db.transaction(async (tx) => {
    await tx.delete(transactionItems);
    await tx.delete(transactions);
    await tx.delete(expenses);
    await tx.delete(products);
    await tx.delete(masterItems);

    if (Array.isArray(parsed.P) && parsed.P.length > 0) {
      await tx.insert(products).values(
        parsed.P.map((p) => ({
          kode: String(p.kode),
          nama: String(p.nama || ''),
          kategori: String(p.kategori || ''),
          tipe: String(p.tipe || ''),
          hpp: Math.round(num(p.hpp)),
          harga: Math.round(num(p.harga)),
          hargaA: Math.round(num(p.harga_a)),
          hargaB: Math.round(num(p.harga_b)),
          hargaC: Math.round(num(p.harga_c)),
          hargaD: Math.round(num(p.harga_d)),
          hargaMin: Math.round(num(p.harga_min)),
          stok: Math.floor(num(p.stok)),
          satuan: String(p.satuan || 'Pcs'),
          supplier: String(p.supplier || ''),
          jasa: Boolean(p.jasa),
        })),
      );
    }

    const insertTxList = async (kind: 'sales' | 'purchase', notes: TransactionNote[]) => {
      for (const n of notes) {
        const inserted = await tx
          .insert(transactions)
          .values({
            kind,
            no: String(n.no),
            tgl: String(n.tgl || isoDate()),
            party: String(kind === 'sales' ? n.konsumen || 'Umum' : n.supplier || ''),
            noBukti: String(n.no_bukti || ''),
            tempoHari: Math.floor(num(n.tempo_hari)),
            tempoTgl: String(n.tempo_tgl || ''),
            diskonPersen: num(n.diskon_persen),
            diskonRp: Math.round(num(n.diskon_rp)),
            subtotal: Math.round(num(n.subtotal)),
            diskon: Math.round(num(n.diskon)),
            total: Math.round(num(n.total)),
            keterangan: String(n.keterangan || ''),
            kasir: String(n.kasir || user.username),
            userId: user.id,
            batal: Boolean(n.batal),
            alasan: String(n.alasan || ''),
            hppTotal: Math.round(num(n.hpp)),
          })
          .returning({ id: transactions.id });
        if (Array.isArray(n.items) && n.items.length > 0) {
          await tx.insert(transactionItems).values(
            n.items.map((it) => ({
              transactionId: inserted[0].id,
              kode: String(it.kode || ''),
              nama: String(it.nama || ''),
              harga: Math.round(num(it.harga)),
              qty: Math.max(1, Math.floor(num(it.qty))),
              satuan: String(it.satuan || 'Pcs'),
              diskonRp: Math.round(num(it.diskon_rp)),
              subtotal: Math.round(num(it.subtotal)),
            })),
          );
        }
      }
    };

    if (Array.isArray(parsed.S)) await insertTxList('sales', parsed.S);
    if (Array.isArray(parsed.U)) await insertTxList('purchase', parsed.U);

    if (Array.isArray(parsed.E) && parsed.E.length > 0) {
      await tx.insert(expenses).values(
        parsed.E.map((e) => ({
          nomor: String(e.nomor),
          tgl: String(e.tgl || isoDate()),
          kategori: String(e.kategori || 'Lainnya'),
          keterangan: String(e.keterangan || ''),
          jumlah: Math.round(num(e.jumlah)),
          username: String(e.user || user.username),
          userId: user.id,
        })),
      );
    }

    const masterRows: { type: string; nama: string }[] = [];
    for (const [type, defaults] of Object.entries(DEFAULT_MASTER)) {
      const source = parsed.M?.[type as MasterType];
      const names =
        Array.isArray(source) && source.length > 0
          ? source.map((m) => String(m.nama || '').trim()).filter(Boolean)
          : defaults;
      for (const nama of names) {
        masterRows.push({ type, nama });
      }
    }
    if (masterRows.length > 0) {
      await tx.insert(masterItems).values(masterRows).onConflictDoNothing();
    }
  });
}

export async function restoreDbBackup(
  idInput: unknown,
  konfirmasiInput: unknown,
  user: DbUserRecord,
): Promise<boolean> {
  if (konfirmasiInput !== 'RESTORE') {
    throw new PosDomainError('Konfirmasi RESTORE tidak sesuai');
  }
  const backupKey = String(idInput || '').trim();
  if (!backupKey) throw new PosDomainError('ID backup wajib diisi');

  try {
    const found = await db
      .select()
      .from(backups)
      .where(eq(backups.backupKey, backupKey))
      .limit(1);
    if (!found[0]) throw new PosDomainError('Backup tidak ditemukan', 404);

    await createDbBackup('auto-sebelum-restore');
    const parsed = JSON.parse(found[0].payload);
    await applySnapshot(parsed, user);
    return true;
  } catch (err) {
    handleDbError('restoreDbBackup', err);
  }
}

export async function exportDbJson(): Promise<string> {
  try {
    const snap = await buildSnapshotJson();
    return JSON.stringify({
      version: 1,
      exportedAt: new Date().toISOString(),
      ...snap,
    });
  } catch (err) {
    handleDbError('exportDbJson', err);
  }
}

export async function importDbJson(
  rawJsonInput: unknown,
  user: DbUserRecord,
): Promise<{ produk: number; nota_jual: number; nota_beli: number; biaya: number }> {
  let parsed: {
    P?: Product[];
    S?: TransactionNote[];
    U?: TransactionNote[];
    E?: Expense[];
    M?: Partial<Record<MasterType, MasterItem[]>>;
  };
  try {
    parsed =
      typeof rawJsonInput === 'string'
        ? JSON.parse(rawJsonInput)
        : (rawJsonInput as typeof parsed);
  } catch {
    throw new PosDomainError('Format file backup JSON tidak valid');
  }
  if (!parsed || !Array.isArray(parsed.P) || !Array.isArray(parsed.S)) {
    throw new PosDomainError('Format file backup JSON tidak valid');
  }

  try {
    await createDbBackup('auto-sebelum-impor');
    await applySnapshot(parsed, user);
    return {
      produk: parsed.P.length,
      nota_jual: parsed.S.length,
      nota_beli: Array.isArray(parsed.U) ? parsed.U.length : 0,
      biaya: Array.isArray(parsed.E) ? parsed.E.length : 0,
    };
  } catch (err) {
    handleDbError('importDbJson', err);
  }
}

const QRIS_SETTING_KEY = 'qris_static';

export async function getDbStoreQris(): Promise<{ qris: string }> {
  try {
    const rows = await db
      .select({ value: storeSettings.value })
      .from(storeSettings)
      .where(eq(storeSettings.key, QRIS_SETTING_KEY))
      .limit(1);
    return { qris: rows[0]?.value || '' };
  } catch (err) {
    handleDbError('getDbStoreQris', err);
  }
}

export async function saveDbStoreQris(rawQris: unknown): Promise<{ qris: string }> {
  const raw = String(rawQris || '').trim();
  let cleaned = '';
  if (raw) {
    try {
      cleaned = parseQrisInfo(raw).cleanedPayload;
    } catch (e) {
      throw new PosDomainError(e instanceof Error ? e.message : 'Kode QRIS tidak valid');
    }
  }

  try {
    await db
      .insert(storeSettings)
      .values({
        key: QRIS_SETTING_KEY,
        value: cleaned,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: storeSettings.key,
        set: {
          value: cleaned,
          updatedAt: new Date(),
        },
      });
    return { qris: cleaned };
  } catch (err) {
    handleDbError('saveDbStoreQris', err);
  }
}

const AUTO_BACKUP_SETTING_KEY = 'auto_backup_config';

const DEFAULT_AUTO_BACKUP_CONFIG: AutoBackupConfig = {
  enabled: true,
  time: '22:00',
  keepCount: 14,
  lastRunDate: '',
  lastRunAt: '',
  lastBackupName: '',
  lastStatus: 'idle',
  lastError: '',
};

function getWibDateAndTime(now = new Date()): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value || '';
  const hour = get('hour') === '24' ? '00' : get('hour');
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${hour}:${get('minute')}`,
  };
}

function normalizeAutoBackupConfig(raw: unknown): AutoBackupConfig {
  const obj = raw && typeof raw === 'object' ? (raw as Partial<AutoBackupConfig>) : {};
  const timeStr = typeof obj.time === 'string' ? obj.time.trim() : '';
  const validTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(timeStr)
    ? timeStr
    : DEFAULT_AUTO_BACKUP_CONFIG.time;
  const keepRaw = Number(obj.keepCount);
  const keepCount =
    Number.isFinite(keepRaw) && keepRaw >= 5 && keepRaw <= 30
      ? Math.round(keepRaw)
      : DEFAULT_AUTO_BACKUP_CONFIG.keepCount;

  return {
    enabled: typeof obj.enabled === 'boolean' ? obj.enabled : DEFAULT_AUTO_BACKUP_CONFIG.enabled,
    time: validTime,
    keepCount,
    lastRunDate: typeof obj.lastRunDate === 'string' ? obj.lastRunDate : '',
    lastRunAt: typeof obj.lastRunAt === 'string' ? obj.lastRunAt : '',
    lastBackupName: typeof obj.lastBackupName === 'string' ? obj.lastBackupName : '',
    lastStatus:
      obj.lastStatus === 'ok' || obj.lastStatus === 'err' || obj.lastStatus === 'idle'
        ? obj.lastStatus
        : 'idle',
    lastError: typeof obj.lastError === 'string' ? obj.lastError : '',
  };
}

async function writeAutoBackupConfig(config: AutoBackupConfig): Promise<void> {
  const value = JSON.stringify(config);
  await db
    .insert(storeSettings)
    .values({
      key: AUTO_BACKUP_SETTING_KEY,
      value,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: storeSettings.key,
      set: {
        value,
        updatedAt: new Date(),
      },
    });
}

export async function getDbAutoBackupConfig(): Promise<AutoBackupConfig> {
  try {
    const rows = await db
      .select({ value: storeSettings.value })
      .from(storeSettings)
      .where(eq(storeSettings.key, AUTO_BACKUP_SETTING_KEY))
      .limit(1);
    if (!rows[0]?.value) return { ...DEFAULT_AUTO_BACKUP_CONFIG };
    const parsed = JSON.parse(rows[0].value);
    return normalizeAutoBackupConfig(parsed);
  } catch (err) {
    handleDbError('getDbAutoBackupConfig', err);
  }
}

export async function saveDbAutoBackupConfig(input: unknown): Promise<AutoBackupConfig> {
  const body = input && typeof input === 'object' ? (input as Partial<AutoBackupConfig>) : {};
  if (body.time !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(body.time).trim())) {
    throw new PosDomainError('Format jam backup harus HH:MM (contoh 22:00)');
  }
  try {
    const current = await getDbAutoBackupConfig();
    const next = normalizeAutoBackupConfig({
      ...current,
      ...(typeof body.enabled === 'boolean' ? { enabled: body.enabled } : {}),
      ...(body.time !== undefined ? { time: String(body.time).trim() } : {}),
      ...(body.keepCount !== undefined ? { keepCount: Number(body.keepCount) } : {}),
    });
    await writeAutoBackupConfig(next);
    return next;
  } catch (err) {
    handleDbError('saveDbAutoBackupConfig', err);
  }
}

let autoBackupInFlight: Promise<{
  ran: boolean;
  config: AutoBackupConfig;
  backup?: BackupRecord;
}> | null = null;

export async function runAutoBackupIfDue(
  force = false,
): Promise<{ ran: boolean; config: AutoBackupConfig; backup?: BackupRecord }> {
  if (autoBackupInFlight) return autoBackupInFlight;

  autoBackupInFlight = (async () => {
    const config = await getDbAutoBackupConfig();
    const { date: todayWib, time: nowTimeWib } = getWibDateAndTime();

    if (!force) {
      if (!config.enabled) return { ran: false, config };
      if (config.lastRunDate === todayWib) return { ran: false, config };
      if (nowTimeWib < config.time) return { ran: false, config };
    }

    try {
      const created = await createDbBackup('auto');
      await deleteOldDbBackups(config.keepCount);
      const updated: AutoBackupConfig = {
        ...config,
        lastRunDate: todayWib,
        lastRunAt: new Date().toISOString(),
        lastBackupName: created.nama,
        lastStatus: 'ok',
        lastError: '',
      };
      await writeAutoBackupConfig(updated);
      return { ran: true, config: updated, backup: created };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Gagal menjalankan backup otomatis';
      const failed: AutoBackupConfig = {
        ...config,
        lastStatus: 'err',
        lastError: message,
      };
      await writeAutoBackupConfig(failed).catch(() => {});
      if (force) throw err;
      return { ran: false, config: failed };
    }
  })().finally(() => {
    autoBackupInFlight = null;
  });

  return autoBackupInFlight;
}
