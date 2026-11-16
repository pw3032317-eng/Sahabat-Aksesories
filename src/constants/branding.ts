import type { MasterType, PageId, PriceMode, PriceTier } from '../types/pos';

export const APP_VERSION = '1.1.0';
export const STORE_NAME = 'SAHABAT Accessories & Service';
export const PASANG_FORMULA = { kali: 2, tambah: 75000 };

const SAHABAT_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" fill="none">
  <defs>
    <filter id="sDrop" x="-12%" y="-12%" width="124%" height="128%">
      <feDropShadow dx="0" dy="4" stdDeviation="3.5" flood-color="#09090B" flood-opacity="0.34"/>
    </filter>
    <!-- Colorful squircle app badge backdrop & prismatic border -->
    <linearGradient id="bgBadge" x1="12" y1="10" x2="148" y2="150" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#1E1B4B"/>
      <stop offset="48%" stop-color="#18181B"/>
      <stop offset="100%" stop-color="#2E1025"/>
    </linearGradient>
    <linearGradient id="prismRing" x1="8" y1="8" x2="152" y2="152" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#06B6D4"/>
      <stop offset="32%" stop-color="#8B5CF6"/>
      <stop offset="68%" stop-color="#F43F5E"/>
      <stop offset="100%" stop-color="#F59E0B"/>
    </linearGradient>
    <radialGradient id="auraGlow" cx="50%" cy="46%" r="52%">
      <stop offset="0%" stop-color="#F43F5E" stop-opacity="0.42"/>
      <stop offset="55%" stop-color="#8B5CF6" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#06B6D4" stop-opacity="0"/>
    </radialGradient>
    <!-- Vibrant multi-hue 3D S -->
    <linearGradient id="sVibrantMain" x1="36" y1="26" x2="122" y2="132" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#FDE047"/>
      <stop offset="22%" stop-color="#FB7185"/>
      <stop offset="56%" stop-color="#EF4444"/>
      <stop offset="84%" stop-color="#DB2777"/>
      <stop offset="100%" stop-color="#7E22CE"/>
    </linearGradient>
    <linearGradient id="sFacetTop" x1="40" y1="26" x2="112" y2="82" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#FEF08A" stop-opacity="0.9"/>
      <stop offset="42%" stop-color="#FDBA74" stop-opacity="0.5"/>
      <stop offset="100%" stop-color="#F43F5E" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="sBevelShadow" x1="48" y1="54" x2="116" y2="130" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#4C0519" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#3B0764" stop-opacity="0.88"/>
    </linearGradient>
    <!-- Electric cyan-silver upper crescent wing -->
    <linearGradient id="wingCyan" x1="16" y1="18" x2="66" y2="116" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#FFFFFF"/>
      <stop offset="40%" stop-color="#BAE6FD"/>
      <stop offset="78%" stop-color="#22D3EE"/>
      <stop offset="100%" stop-color="#2563EB"/>
    </linearGradient>
    <!-- Sunset gold-rose lower blade -->
    <linearGradient id="wingGoldRose" x1="26" y1="92" x2="146" y2="128" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#F472B6"/>
      <stop offset="42%" stop-color="#FFFBEB"/>
      <stop offset="76%" stop-color="#FBBF24"/>
      <stop offset="100%" stop-color="#F97316"/>
    </linearGradient>
  </defs>

  <!-- App Icon Squircle Frame -->
  <rect x="6" y="6" width="148" height="148" rx="36" fill="url(#bgBadge)" stroke="url(#prismRing)" stroke-width="5"/>
  <rect x="12" y="12" width="136" height="136" rx="30" fill="url(#auraGlow)"/>

  <!-- Decorative subtle circuit / tech orbit ring -->
  <circle cx="80" cy="80" r="54" stroke="#FFFFFF" stroke-opacity="0.09" stroke-width="1.5" stroke-dasharray="6 6"/>

  <g filter="url(#sDrop)">
    <!-- Crisp white outer sticker aura -->
    <g stroke="#FFFFFF" stroke-width="9.5" stroke-linejoin="round" stroke-linecap="round" fill="#FFFFFF">
      <path d="M 88 22 C 52 18, 19 34, 19 64 C 19 85, 38 104, 70 117 L 80 111 C 46 98, 33 79, 35 58 C 37 38, 60 26, 88 22 Z"/>
      <path d="M 27 89 C 27 116, 50 135, 80 134 C 84 134, 88 132, 91 135 C 109 137, 130 131, 143 120 C 124 126, 100 124, 74 113 C 50 103, 35 95, 27 89 Z"/>
      <path d="M 76 29 L 111 29 L 116 53 L 75 53 C 62 53, 62 64, 79 68 C 107 75, 118 87, 116 104 C 114 119, 97 127, 73 125 L 47 123 L 49 102 L 75 102 C 90 102, 92 93, 73 87 C 45 78, 36 67, 36 50 C 36 33, 52 29, 76 29 Z"/>
    </g>

    <!-- Charcoal framing stroke -->
    <g stroke="#18181B" stroke-width="5.5" stroke-linejoin="round" stroke-linecap="round" fill="#18181B">
      <path d="M 88 22 C 52 18, 19 34, 19 64 C 19 85, 38 104, 70 117 L 80 111 C 46 98, 33 79, 35 58 C 37 38, 60 26, 88 22 Z"/>
      <path d="M 27 89 C 27 116, 50 135, 80 134 C 84 134, 88 132, 91 135 C 109 137, 130 131, 143 120 C 124 126, 100 124, 74 113 C 50 103, 35 95, 27 89 Z"/>
      <path d="M 76 29 L 111 29 L 116 53 L 75 53 C 62 53, 62 64, 79 68 C 107 75, 118 87, 116 104 C 114 119, 97 127, 73 125 L 47 123 L 49 102 L 75 102 C 90 102, 92 93, 73 87 C 45 78, 36 67, 36 50 C 36 33, 52 29, 76 29 Z"/>
    </g>

    <!-- Recessed plum-indigo cradle behind S -->
    <path d="M 82 26 C 48 26, 28 41, 30 69 C 32 95, 54 114, 86 120 L 80 103 C 54 96, 43 75, 45 54 C 47 39, 64 31, 82 26 Z" fill="#3B0764"/>

    <!-- Multi-colored 3D S Core -->
    <path d="M 76 29 L 111 29 L 116 53 L 75 53 C 62 53, 62 64, 79 68 C 107 75, 118 87, 116 104 C 114 119, 97 127, 73 125 L 47 123 L 49 102 L 75 102 C 90 102, 92 93, 73 87 C 45 78, 36 67, 36 50 C 36 33, 52 29, 76 29 Z" fill="url(#sVibrantMain)"/>

    <!-- Inner 3D depth shadows -->
    <path d="M 116 53 L 75 53 C 65 53, 63 60, 69 64 C 63 58, 66 49, 77 49 L 113 49 Z" fill="url(#sBevelShadow)"/>
    <path d="M 75 102 L 49 102 L 47 123 L 73 125 C 96 126, 112 119, 116 104 C 111 116, 95 120, 73 119 L 52 117 L 53 106 L 77 106 C 90 106, 94 97, 84 91 C 91 97, 88 102, 75 102 Z" fill="url(#sBevelShadow)"/>

    <!-- Top-left golden specular facet -->
    <path d="M 76 31 L 109 31 L 112 40 L 76 40 C 54 40, 46 46, 47 55 C 48 65, 58 71, 79 78 C 100 84, 109 92, 109 102 C 105 93, 94 87, 73 81 C 50 74, 39 64, 39 50 C 39 36, 54 31, 76 31 Z" fill="url(#sFacetTop)"/>
    <path d="M 76 30.5 L 110 30.5" stroke="#FEF9C3" stroke-opacity="0.85" stroke-width="2" stroke-linecap="round"/>

    <!-- Lower sweeping gold-rose blade -->
    <path d="M 27 89 C 27 116, 50 135, 80 134 C 84 134, 88 132, 91 135 C 109 137, 130 131, 143 120 C 124 126, 100 124, 74 113 C 50 103, 35 95, 27 89 Z" fill="url(#wingGoldRose)" stroke="#18181B" stroke-width="2" stroke-linejoin="round"/>
    <!-- Upper sweeping electric cyan-silver crescent wing -->
    <path d="M 88 22 C 52 18, 19 34, 19 64 C 19 86, 39 107, 78 119 C 53 104, 35 84, 35 60 C 35 38, 58 26, 88 22 Z" fill="url(#wingCyan)" stroke="#18181B" stroke-width="2" stroke-linejoin="round"/>

    <!-- Crisp edge specular glints -->
    <path d="M 74 24 C 46 25, 24 38, 24 62 C 24 78, 34 94, 54 107" stroke="#FFFFFF" stroke-opacity="0.92" stroke-width="2" stroke-linecap="round"/>
    <path d="M 34 109 C 48 126, 72 133, 132 124" stroke="#FFFFFF" stroke-opacity="0.85" stroke-width="1.6" stroke-linecap="round"/>
  </g>

  <!-- Signature 4-point star sparkle accent -->
  <path d="M 126 26 L 128.8 33.2 L 136 36 L 128.8 38.8 L 126 46 L 123.2 38.8 L 116 36 L 123.2 33.2 Z" fill="#FDE047"/>
  <circle cx="126" cy="36" r="2.2" fill="#FFFFFF"/>
</svg>`;

export const LOGO_DATA_URI = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(SAHABAT_LOGO_SVG)}`;

export const ICON_DATA_URI = LOGO_DATA_URI;

export interface MenuDef {
  id: PageId;
  label: string;
  shortcut: string;
  ownerOnly?: boolean;
}

export const MENUS: MenuDef[] = [
  { id: 'dashboard', label: 'Dashboard', shortcut: '' },
  { id: 'sales', label: 'Penjualan', shortcut: 'F1' },
  { id: 'purchase', label: 'Pembelian', shortcut: 'F2' },
  { id: 'expense', label: 'Biaya', shortcut: 'F3' },
  { id: 'product', label: 'Produk', shortcut: 'F4' },
  { id: 'search', label: 'Cek Harga', shortcut: 'F5' },
  { id: 'report', label: 'Laporan', shortcut: 'F6' },
  { id: 'master', label: 'Master', shortcut: 'F7' },
  { id: 'utility', label: 'Utilitas', shortcut: 'F8', ownerOnly: true },
  { id: 'account', label: 'Akun', shortcut: 'F9', ownerOnly: true },
];

export const FKEYS: Record<string, PageId> = {
  F1: 'sales',
  F2: 'purchase',
  F3: 'expense',
  F4: 'product',
  F5: 'search',
  F6: 'report',
  F7: 'master',
  F8: 'utility',
  F9: 'account',
};

export const TIERS: [PriceTier, string][] = [
  ['harga', 'Umum'],
  ['harga_a', 'Toko'],
  ['harga_b', 'Harga B'],
  ['harga_c', 'Harga C'],
  ['harga_d', 'Harga D'],
];

export const PRICE_MODE_LABEL: Record<PriceMode, string> = {
  umum: 'Harga Umum',
  toko: 'Harga Toko',
  pasang: 'Sekalian Pasang',
};

export const MASTER_TABS: [MasterType, string][] = [
  ['konsumen', 'Konsumen'],
  ['supplier', 'Supplier'],
  ['biaya', 'Daftar Biaya'],
  ['kartu', 'Jenis Kartu'],
  ['kategori', 'Kategori Barang'],
  ['tipe', 'Tipe Barang'],
  ['satuan', 'Satuan Barang'],
];

export const PRODUCT_CSV_COLS = [
  'kode',
  'nama',
  'kategori',
  'tipe',
  'hpp',
  'harga',
  'harga_a',
  'harga_b',
  'harga_c',
  'harga_d',
  'harga_min',
  'stok',
  'satuan',
  'supplier',
  'jasa',
] as const;
