import { relations } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').unique(),
  email: text('email').notNull().unique(),
  username: text('username').notNull(),
  passwordHash: text('password_hash'),
  role: text('role').notNull().default('admin'),
  perms: jsonb('perms').$type<'*' | string[]>().notNull().default([]),
  aktif: boolean('aktif').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const storeSettings = pgTable('store_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull().default(''),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const products = pgTable('products', {
  id: serial('id').primaryKey(),
  kode: text('kode').notNull().unique(),
  nama: text('nama').notNull(),
  kategori: text('kategori').notNull().default(''),
  tipe: text('tipe').notNull().default(''),
  hpp: integer('hpp').notNull().default(0),
  harga: integer('harga').notNull().default(0),
  hargaA: integer('harga_a').notNull().default(0),
  hargaB: integer('harga_b').notNull().default(0),
  hargaC: integer('harga_c').notNull().default(0),
  hargaD: integer('harga_d').notNull().default(0),
  hargaMin: integer('harga_min').notNull().default(0),
  stok: integer('stok').notNull().default(0),
  satuan: text('satuan').notNull().default('Pcs'),
  supplier: text('supplier').notNull().default(''),
  jasa: boolean('jasa').notNull().default(false),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const transactions = pgTable(
  'transactions',
  {
    id: serial('id').primaryKey(),
    kind: text('kind').notNull(), // 'sales' | 'purchase'
    no: text('no').notNull(),
    tgl: text('tgl').notNull(),
    party: text('party').notNull().default(''),
    noBukti: text('no_bukti').notNull().default(''),
    tempoHari: integer('tempo_hari').notNull().default(0),
    tempoTgl: text('tempo_tgl').notNull().default(''),
    diskonPersen: doublePrecision('diskon_persen').notNull().default(0),
    diskonRp: integer('diskon_rp').notNull().default(0),
    subtotal: integer('subtotal').notNull().default(0),
    diskon: integer('diskon').notNull().default(0),
    total: integer('total').notNull().default(0),
    keterangan: text('keterangan').notNull().default(''),
    kasir: text('kasir').notNull().default('-'),
    userId: integer('user_id').references(() => users.id),
    batal: boolean('batal').notNull().default(false),
    alasan: text('alasan').notNull().default(''),
    hppTotal: integer('hpp_total').notNull().default(0),
    requestId: text('request_id').unique(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('transactions_kind_no_idx').on(table.kind, table.no)],
);

export const transactionItems = pgTable('transaction_items', {
  id: serial('id').primaryKey(),
  transactionId: integer('transaction_id')
    .references(() => transactions.id, { onDelete: 'cascade' })
    .notNull(),
  kode: text('kode').notNull(),
  nama: text('nama').notNull(),
  harga: integer('harga').notNull().default(0),
  qty: integer('qty').notNull().default(1),
  satuan: text('satuan').notNull().default('Pcs'),
  diskonRp: integer('diskon_rp').notNull().default(0),
  subtotal: integer('subtotal').notNull().default(0),
});

export const expenses = pgTable('expenses', {
  id: serial('id').primaryKey(),
  nomor: text('nomor').notNull().unique(),
  tgl: text('tgl').notNull(),
  kategori: text('kategori').notNull(),
  keterangan: text('keterangan').notNull().default(''),
  jumlah: integer('jumlah').notNull().default(0),
  username: text('username').notNull().default(''),
  userId: integer('user_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const masterItems = pgTable(
  'master_items',
  {
    id: serial('id').primaryKey(),
    type: text('type').notNull(),
    nama: text('nama').notNull(),
  },
  (table) => [uniqueIndex('master_items_type_nama_idx').on(table.type, table.nama)],
);

export const backups = pgTable('backups', {
  id: serial('id').primaryKey(),
  backupKey: text('backup_key').notNull().unique(),
  nama: text('nama').notNull(),
  waktu: timestamp('waktu').defaultNow().notNull(),
  ukuran: integer('ukuran').notNull().default(0),
  produk: integer('produk').notNull().default(0),
  notaJual: integer('nota_jual').notNull().default(0),
  notaBeli: integer('nota_beli').notNull().default(0),
  biaya: integer('biaya').notNull().default(0),
  payload: text('payload').notNull(),
});

export const usersRelations = relations(users, ({ many }) => ({
  transactions: many(transactions),
  expenses: many(expenses),
}));

export const transactionsRelations = relations(transactions, ({ one, many }) => ({
  author: one(users, {
    fields: [transactions.userId],
    references: [users.id],
  }),
  items: many(transactionItems),
}));

export const transactionItemsRelations = relations(transactionItems, ({ one }) => ({
  transaction: one(transactions, {
    fields: [transactionItems.transactionId],
    references: [transactions.id],
  }),
}));

export const expensesRelations = relations(expenses, ({ one }) => ({
  author: one(users, {
    fields: [expenses.userId],
    references: [users.id],
  }),
}));
