export type UserRole = 'owner' | 'admin';

export type PageId =
  | 'dashboard'
  | 'sales'
  | 'purchase'
  | 'expense'
  | 'product'
  | 'search'
  | 'report'
  | 'master'
  | 'utility'
  | 'account';

export interface Session {
  token: string;
  user: string;
  email?: string;
  role: UserRole;
  perms: '*' | PageId[];
  authType?: 'credentials' | 'google';
  deviceType?: 'mobile' | 'desktop';
}

export interface Product {
  kode: string;
  nama: string;
  kategori: string;
  tipe: string;
  hpp?: number;
  harga: number;
  harga_a: number;
  harga_b: number;
  harga_c: number;
  harga_d: number;
  harga_min: number;
  stok: number;
  satuan: string;
  supplier: string;
  jasa: boolean;
}

export type PriceTier = 'harga' | 'harga_a' | 'harga_b' | 'harga_c' | 'harga_d';
export type PriceMode = 'umum' | 'toko' | 'pasang';

export interface CartItem {
  kode: string;
  nama: string;
  harga: number;
  qty: number;
  satuan: string;
  dp: number; // diskon persen
  dr: number; // diskon rupiah
  tier: PriceTier | '';
  min: number;
  hpp: number;
}

export interface NoteItem {
  kode: string;
  nama: string;
  harga: number;
  qty: number;
  satuan: string;
  diskon_rp: number;
  subtotal: number;
}

export interface TransactionNote {
  no: string;
  tgl: string;
  konsumen?: string;
  supplier?: string;
  no_bukti: string;
  tempo_hari: number;
  tempo_tgl: string;
  diskon_persen: number;
  diskon_rp: number;
  subtotal: number;
  diskon: number;
  total: number;
  keterangan: string;
  kasir: string;
  batal: boolean;
  alasan?: string;
  hpp?: number;
  items: NoteItem[];
}

export interface TransactionSummary {
  no: string;
  tgl: string;
  pihak: string;
  total: number;
  batal: boolean;
}

export interface GlobalTransactionSearchItem {
  kind: 'sales' | 'purchase';
  no: string;
  tgl: string;
  pihak: string;
  no_bukti: string;
  keterangan: string;
  kasir: string;
  total: number;
  batal: boolean;
}

export interface Expense {
  nomor: string;
  tgl: string;
  kategori: string;
  keterangan: string;
  jumlah: number;
  user?: string;
}

export type MasterType =
  | 'konsumen'
  | 'supplier'
  | 'biaya'
  | 'kartu'
  | 'kategori'
  | 'tipe'
  | 'satuan';

export interface MasterItem {
  id: number;
  nama: string;
}

export interface BackupRecord {
  id: string;
  nama: string;
  waktu: string;
  ukuran: number;
  url: string;
  produk: number;
  nota_jual: number;
  nota_beli: number;
  biaya: number;
}

export interface AutoBackupConfig {
  enabled: boolean;
  time: string;
  keepCount: number;
  lastRunDate: string;
  lastRunAt: string;
  lastBackupName: string;
  lastStatus: 'idle' | 'ok' | 'err';
  lastError?: string;
}

export interface UserAccount {
  username: string;
  email?: string;
  role: UserRole;
  perms: '*' | PageId[];
  aktif: boolean;
  hasPassword?: boolean;
}

export interface DashboardData {
  sales: number;
  todayTxCount?: number;
  todayHpp?: number;
  purch: number;
  exp: number;
  profit: number;
  low: number;
  week: { tgl: string; total: number }[];
  recent: { no: string; tgl: string; konsumen: string; total: number }[];
  top: { nama: string; qty: number }[];
}

export type ReportType = 'sales' | 'purchase' | 'expense' | 'profit' | 'stock';

export type SalesGroupKey = 'LCD' | 'Sparepart' | 'Aksesoris' | 'Jasa Service' | 'Lainnya';

export interface SalesGroupSummary {
  group: SalesGroupKey;
  label: string;
  qty: number;
  notaCount: number;
  omset: number;
  categories: string[];
}

export interface SalesCategorySummary {
  kategori: string;
  group: SalesGroupKey;
  qty: number;
  notaCount: number;
  omset: number;
}

export interface SalesTrendPoint {
  tgl: string;
  LCD: number;
  Sparepart: number;
  Aksesoris: number;
  'Jasa Service': number;
  Lainnya: number;
  total: number;
}

export interface ReportTable {
  cols: [string, 't' | 'n' | 'r'][];
  rows: (string | number)[][];
  foot?: (string | number)[];
  sum?: {
    cols: [string, 't' | 'n' | 'r'][];
    rows: (string | number)[][];
  };
  salesGroups?: SalesGroupSummary[];
  salesCategories?: SalesCategorySummary[];
  salesTrend?: SalesTrendPoint[];
  totalOmset?: number;
}

export interface MonthlySalesMetric {
  ym: string;
  label: string;
  fullLabel: string;
  omset: number;
  prevOmset: number;
  omsetDelta: number;
  growthPct: number | null;
  notaCount: number;
  qtyCount: number;
  avgNota: number;
  LCD: number;
  Sparepart: number;
  Aksesoris: number;
  'Jasa Service': number;
  Lainnya: number;
}

export interface SalesGroupMomSummary {
  group: SalesGroupKey;
  label: string;
  currentOmset: number;
  previousOmset: number;
  delta: number;
  growthPct: number | null;
  currentQty: number;
  previousQty: number;
}

export interface DailyCumulativePoint {
  day: number;
  label: string;
  currentDaily: number | null;
  currentCum: number | null;
  prevDaily: number | null;
  prevCum: number | null;
}

export interface SalesMomComparison {
  selectedYm: string;
  previousYm: string;
  selectedLabel: string;
  previousLabel: string;
  isCurrentMonth: boolean;
  mtdDay: number | null;
  mtdSummary: {
    currentOmset: number;
    previousMtdOmset: number;
    delta: number;
    growthPct: number | null;
    currentNota: number;
    previousMtdNota: number;
  } | null;
  selected: MonthlySalesMetric;
  previous: MonthlySalesMetric;
  notaDelta: number;
  notaGrowthPct: number | null;
  qtyDelta: number;
  qtyGrowthPct: number | null;
  avgNotaDelta: number;
  avgNotaGrowthPct: number | null;
  series: MonthlySalesMetric[];
  groupComparison: SalesGroupMomSummary[];
  dailyCumulative: DailyCumulativePoint[];
}

