import { PASANG_FORMULA } from '../constants/branding.ts';
import type { CartItem, PriceMode, Product } from '../types/pos';

export function rp(n: number | undefined | null): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(n || 0);
}

export function fmtDate(iso: string): string {
  if (!iso) return '-';
  const parts = String(iso).split('-');
  if (parts.length !== 3) return iso;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

export function isoDate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function norm(s: string | undefined | null): string {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function num(v: unknown): number {
  return Math.max(0, Number(v) || 0);
}

export function lineSubtotal(i: Pick<CartItem, 'harga' | 'qty' | 'dp' | 'dr'>): number {
  return Math.max(0, Math.round(i.harga * i.qty * (1 - i.dp / 100) - i.dr));
}

export function priceOf(p: Product, mode: PriceMode): number {
  if (mode === 'umum') return p.harga || 0;
  if (mode === 'toko') return p.harga_a || 0;
  return p.harga > 0 ? p.harga * PASANG_FORMULA.kali + PASANG_FORMULA.tambah : 0;
}

export function priceModeNote(mode: PriceMode): string {
  if (mode === 'umum') return 'Harga umum diambil dari kolom Harga Jual pada data Produk.';
  if (mode === 'toko') return 'Harga toko diambil dari kolom Harga A pada data Produk.';
  return `Sekalian pasang = Harga Umum × ${PASANG_FORMULA.kali} + ${rp(PASANG_FORMULA.tambah)}.`;
}

export function rangeOf(preset: 'today' | 'week' | 'month'): [string, string] {
  const t = new Date();
  const iso = isoDate(t);
  if (preset === 'today') return [iso, iso];
  if (preset === 'week') {
    const d = new Date(t);
    d.setDate(t.getDate() - ((t.getDay() + 6) % 7));
    return [isoDate(d), iso];
  }
  return [`${iso.slice(0, 8)}01`, iso];
}

export function createUid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `r${Date.now()}${Math.random().toString(16).slice(2)}`;
  }
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const a = document.createElement('textarea');
      a.value = text;
      a.style.position = 'fixed';
      a.style.opacity = '0';
      document.body.appendChild(a);
      a.select();
      const ok = document.execCommand('copy');
      a.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function parseCsvText(rawText: string): string[][] {
  const text = rawText.replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  // Auto-detect semicolon vs comma delimiter (Indonesian Excel exports often use ;)
  const firstLine = lines[0];
  const semiCount = (firstLine.match(/;/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  const delim = semiCount > commaCount ? ';' : ',';

  return lines.map((line) => {
    const cells: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === delim && !inQuotes) {
        cells.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    cells.push(current.trim());
    return cells;
  });
}

export function exportToCsv(filename: string, headers: string[], rows: (string | number | boolean | undefined)[][]): void {
  const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csvBody = [headers.map(q).join(',')]
    .concat(rows.map((r) => r.map(q).join(',')))
    .join('\r\n');
  const blob = new Blob([`\uFEFF${csvBody}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const HTML_ESC_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => HTML_ESC_MAP[ch] || ch);
}
