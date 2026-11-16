import { useEffect, useState, type ReactNode } from 'react';
import { X, Printer, Share2, Ban, Copy, MessageCircle, StickyNote } from 'lucide-react';
import { LOGO_DATA_URI, STORE_NAME } from '../../constants/branding';
import type { TransactionNote } from '../../types/pos';
import { copyToClipboard, escapeHtml, fmtDate, rp } from '../../utils/format';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  maxWidth?: string;
}

export function Modal({ title, onClose, children, maxWidth = 'max-w-lg' }: ModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-zinc-950/65 backdrop-blur-[2px] p-0 sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`w-full ${maxWidth} max-h-[88dvh] flex flex-col rounded-t-3xl sm:rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-2xl overflow-hidden pb-safe`}
      >
        <div className="sm:hidden w-10 h-1 rounded-full bg-zinc-300 dark:bg-zinc-700 mx-auto mt-2.5 shrink-0" />
        <div className="flex items-start justify-between gap-3 px-5 py-3.5 sm:py-4 border-b border-zinc-200 dark:border-zinc-800">
          <h3 className="text-base font-bold text-zinc-900 dark:text-white leading-snug break-words [overflow-wrap:anywhere] min-w-0">
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] min-w-[40px] shrink-0 flex items-center justify-center rounded-xl text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-white transition-colors"
            aria-label="Tutup dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 overflow-y-auto flex-1">{children}</div>
      </div>
    </div>
  );
}

interface ConfirmModalProps {
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  message,
  confirmLabel = 'Ya, lanjutkan',
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  return (
    <Modal title="Konfirmasi" onClose={onCancel} maxWidth="max-w-sm">
      <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">{message}</p>
      <div className="mt-5 flex items-center justify-end gap-2.5">
        <button
          type="button"
          onClick={onCancel}
          className="min-h-[44px] px-4 rounded-xl border border-zinc-300 dark:border-zinc-700 text-sm font-semibold text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
        >
          Batal
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className={`min-h-[44px] px-4 rounded-xl text-sm font-semibold text-white transition-colors ${
            danger
              ? 'bg-rose-600 hover:bg-rose-700'
              : 'bg-red-600 hover:bg-red-700'
          }`}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

function triggerPrint(pageCss: string, areaClass: string, html: string): void {
  const area = document.getElementById('print-area');
  if (!area) return;

  let pageStyle = document.getElementById('print-page-style');
  if (!pageStyle) {
    pageStyle = document.createElement('style');
    pageStyle.id = 'print-page-style';
    document.head.appendChild(pageStyle);
  }
  pageStyle.textContent = pageCss;
  area.className = areaClass;
  area.innerHTML = html;
  setTimeout(() => window.print(), 60);
}

export function printReceipt(
  note: TransactionNote,
  kind: 'sales' | 'purchase',
  paper: '58' | '80' | 'a5',
  customCatatan?: string,
): void {
  const partyLabel = kind === 'sales' ? 'Konsumen' : 'Supplier';
  const partyValue = kind === 'sales' ? note.konsumen || 'Umum' : note.supplier || '-';
  const staffLabel = kind === 'sales' ? 'Kasir' : 'Petugas';
  const notaTitle = kind === 'sales' ? 'Nota Penjualan' : 'Nota Pembelian';
  const catatanText = (customCatatan !== undefined ? customCatatan : note.keterangan || '').trim();

  const row = (l: string, r: string) =>
    `<div style="display:flex;justify-content:space-between;gap:8px"><span>${l}</span><span>${r}</span></div>`;

  const html = `
    <div style="padding:4px 0;color:#000">
      <img class="receipt-logo" src="${LOGO_DATA_URI}" alt="" style="display:block;margin:0 auto 6px;width:54px;height:54px;object-fit:contain" />
      <div style="text-align:center;font-weight:700;font-size:1.1em">${STORE_NAME}</div>
      <div style="text-align:center">${notaTitle}${note.batal ? ' (BATAL)' : ''}</div>
      <hr style="border:0;border-top:1px dashed #000;margin:6px 0" />
      <div>No: ${escapeHtml(note.no)}</div>
      <div>Tanggal: ${fmtDate(note.tgl)}</div>
      <div>${staffLabel}: ${escapeHtml(note.kasir || '-')}</div>
      <div>${partyLabel}: ${escapeHtml(partyValue)}</div>
      <hr style="border:0;border-top:1px dashed #000;margin:6px 0" />
      ${note.items
        .map(
          (i) =>
            `<div style="margin-bottom:4px"><div>${escapeHtml(i.nama)}</div>${row(`${i.qty} x ${rp(i.harga)}`, rp(i.subtotal))}</div>`,
        )
        .join('')}
      <hr style="border:0;border-top:1px dashed #000;margin:6px 0" />
      ${row('Subtotal', rp(note.subtotal ?? note.total))}
      ${note.diskon ? row('Diskon', `-${rp(note.diskon)}`) : ''}
      ${row('<b>TOTAL</b>', `<b>${rp(note.total)}</b>`)}
      ${note.tempo_tgl ? row('Jatuh tempo', fmtDate(note.tempo_tgl)) : ''}
      ${
        catatanText
          ? `<hr style="border:0;border-top:1px dashed #000;margin:6px 0" /><div style="white-space:pre-wrap">Catatan: ${escapeHtml(catatanText)}</div>`
          : ''
      }
      <hr style="border:0;border-top:1px dashed #000;margin:6px 0" />
      <div style="text-align:center">Terima kasih</div>
    </div>
  `;

  triggerPrint(
    `@page{size:${paper === 'a5' ? 'A5' : `${paper}mm auto`};margin:4mm}`,
    `paper-${paper}`,
    html,
  );
}

export function printReportHtml(html: string): void {
  triggerPrint('@page{size:A4;margin:12mm}', 'paper-a4', html);
}

function getInitialPaper(): '58' | '80' | 'a5' {
  try {
    const saved = localStorage.getItem('sahabat_paper');
    if (saved === '58' || saved === '80' || saved === 'a5') return saved;
  } catch {
    // ignore
  }
  return '58';
}

interface ReceiptModalProps {
  note: TransactionNote;
  kind: 'sales' | 'purchase';
  isOwner: boolean;
  onCancelNote: (alasan: string) => Promise<void>;
  onToast?: (msg: string, type?: 'ok' | 'warn' | 'err' | 'info') => void;
  onClose: () => void;
}

export function ReceiptModal({
  note,
  kind,
  isOwner,
  onCancelNote,
  onToast,
  onClose,
}: ReceiptModalProps) {
  const [canceling, setCanceling] = useState(false);
  const [reason, setReason] = useState('');
  const [showCancelForm, setShowCancelForm] = useState(false);
  const [receiptCatatan, setReceiptCatatan] = useState(note.keterangan || '');
  const [paper, setPaper] = useState<'58' | '80' | 'a5'>(() => getInitialPaper());

  const partyLabel = kind === 'sales' ? 'Konsumen' : 'Supplier';
  const partyValue = kind === 'sales' ? note.konsumen || 'Umum' : note.supplier || '-';
  const notaTitle = kind === 'sales' ? 'Nota Penjualan' : 'Nota Pembelian';

  const buildShareText = () => {
    const lines = [
      `*${STORE_NAME}*`,
      notaTitle + (note.batal ? ' (BATAL)' : ''),
      `No: ${note.no}`,
      `Tanggal: ${fmtDate(note.tgl)}`,
      `${kind === 'sales' ? 'Kasir' : 'Petugas'}: ${note.kasir || '-'}`,
      `${partyLabel}: ${partyValue}`,
      '',
    ];
    note.items.forEach((i) => {
      lines.push(i.nama, `  ${i.qty} x ${rp(i.harga)} = ${rp(i.subtotal)}`);
    });
    lines.push('', `Subtotal: ${rp(note.subtotal ?? note.total)}`);
    if (note.diskon) lines.push(`Diskon: -${rp(note.diskon)}`);
    lines.push(`*TOTAL: ${rp(note.total)}*`);
    if (note.tempo_tgl) lines.push(`Jatuh tempo: ${fmtDate(note.tempo_tgl)}`);
    const cleanNote = receiptCatatan.trim();
    if (cleanNote) lines.push('', `Catatan: ${cleanNote}`);
    lines.push('', 'Terima kasih');
    return lines.join('\n');
  };

  const handleNativeShare = async () => {
    const text = buildShareText();
    if (navigator.share) {
      try {
        await navigator.share({
          title: `${notaTitle} ${note.no} — ${STORE_NAME}`,
          text,
        });
        return;
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
      }
    }
    const ok = await copyToClipboard(text);
    if (ok) {
      onToast?.('Teks struk disalin — siap langsung dibagikan', 'ok');
    } else {
      onToast?.('Gunakan tombol WhatsApp atau cetak langsung', 'info');
    }
  };

  const handleCopyStruk = async () => {
    const ok = await copyToClipboard(buildShareText());
    if (ok) {
      onToast?.('Struk berhasil disalin tanpa menyimpan file', 'ok');
    } else {
      onToast?.('Gagal menyalin otomatis, gunakan tombol Bagikan / WhatsApp', 'warn');
    }
  };

  const handleSelectPaper = (size: '58' | '80' | 'a5') => {
    setPaper(size);
    try {
      localStorage.setItem('sahabat_paper', size);
    } catch {
      // ignore
    }
  };

  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(buildShareText())}`;

  return (
    <Modal title={`Bagikan & Print Struk · ${note.no}`} onClose={onClose} maxWidth="max-w-md">
      <div className="rounded-xl bg-white text-zinc-900 p-4 border border-zinc-200 font-data text-xs leading-relaxed">
        <img
          src={LOGO_DATA_URI}
          alt={STORE_NAME}
          className="w-12 h-12 object-contain mx-auto mb-2"
        />
        <div className="text-center font-bold text-sm">{STORE_NAME}</div>
        <div className="text-center text-zinc-600 mb-2">
          {notaTitle}
          {note.batal ? ' · DIBATALKAN' : ''}
        </div>
        <div className="border-t border-dashed border-zinc-300 my-2 pt-2 space-y-0.5">
          <div>No: {note.no}</div>
          <div>Tanggal: {fmtDate(note.tgl)}</div>
          <div>
            {kind === 'sales' ? 'Kasir' : 'Petugas'}: {note.kasir || '-'}
          </div>
          <div>
            {partyLabel}: {partyValue}
          </div>
        </div>
        <div className="border-t border-dashed border-zinc-300 my-2 pt-2 space-y-1.5">
          {note.items.map((item, idx) => (
            <div key={idx}>
              <div className="font-semibold">{item.nama}</div>
              <div className="flex justify-between text-zinc-700">
                <span>
                  {item.qty} × {rp(item.harga)}
                </span>
                <span>{rp(item.subtotal)}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="border-t border-dashed border-zinc-300 my-2 pt-2 space-y-1">
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span>{rp(note.subtotal ?? note.total)}</span>
          </div>
          {note.diskon > 0 && (
            <div className="flex justify-between text-rose-700">
              <span>Diskon</span>
              <span>-{rp(note.diskon)}</span>
            </div>
          )}
          <div className="flex justify-between font-bold text-sm pt-1">
            <span>TOTAL</span>
            <span>{rp(note.total)}</span>
          </div>
          {note.tempo_tgl && (
            <div className="flex justify-between text-zinc-600">
              <span>Jatuh tempo</span>
              <span>{fmtDate(note.tempo_tgl)}</span>
            </div>
          )}
        </div>
        {receiptCatatan.trim() && (
          <div className="border-t border-dashed border-zinc-300 my-2 pt-2 text-zinc-700 whitespace-pre-wrap">
            <span className="font-semibold">Catatan:</span> {receiptCatatan.trim()}
          </div>
        )}
        {note.batal && note.alasan && (
          <div className="mt-2 p-2 rounded bg-rose-50 text-rose-700">
            Alasan batal: {note.alasan}
          </div>
        )}
      </div>

      {/* Kolom Catatan pada Struk */}
      <div className="mt-3.5 space-y-1.5">
        <label
          htmlFor="receipt-note-input"
          className="flex items-center gap-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-200"
        >
          <StickyNote className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
          Catatan pada Struk (opsional)
        </label>
        <textarea
          id="receipt-note-input"
          rows={2}
          value={receiptCatatan}
          onChange={(e) => setReceiptCatatan(e.target.value)}
          placeholder="Contoh: Garansi service 7 hari / barang sudah dicek bersama"
          className="w-full px-3 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-600 resize-none"
        />
      </div>

      {showCancelForm && (
        <div className="mt-4 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 space-y-2.5">
          <label className="block text-xs font-semibold text-rose-800 dark:text-rose-200">
            Alasan pembatalan nota (wajib)
          </label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Contoh: salah input barang"
            className="w-full min-h-[44px] px-3 rounded-xl border border-rose-300 dark:border-rose-700 bg-white dark:bg-zinc-900 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowCancelForm(false)}
              className="min-h-[40px] px-3 rounded-lg text-xs font-semibold text-zinc-600 dark:text-zinc-300"
            >
              Kembali
            </button>
            <button
              type="button"
              disabled={canceling || !reason.trim()}
              onClick={async () => {
                setCanceling(true);
                try {
                  await onCancelNote(reason.trim());
                } finally {
                  setCanceling(false);
                }
              }}
              className="min-h-[40px] px-4 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-semibold"
            >
              {canceling ? 'Membatalkan...' : 'Konfirmasi Batal'}
            </button>
          </div>
        </div>
      )}

      {/* Menu Bagikan Langsung (Tanpa Save ke HP/Laptop) */}
      <div className="mt-4 space-y-2.5">
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={handleNativeShare}
            className="min-h-[44px] px-3 rounded-xl bg-gradient-to-r from-red-600 to-rose-700 hover:from-red-700 hover:to-rose-800 text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow-sm shadow-red-600/20"
          >
            <Share2 className="w-4 h-4 shrink-0" /> Bagikan
          </button>
          <a
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="min-h-[44px] px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow-sm"
          >
            <MessageCircle className="w-4 h-4 shrink-0" /> WhatsApp
          </a>
          <button
            type="button"
            onClick={handleCopyStruk}
            className="min-h-[44px] px-3 rounded-xl border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-100 text-xs font-semibold flex items-center justify-center gap-1.5"
          >
            <Copy className="w-4 h-4 shrink-0" /> Salin Teks
          </button>
        </div>

        {/* Print Langsung */}
        <div className="flex items-center gap-2 pt-1">
          <div className="inline-flex p-1 rounded-xl bg-zinc-100 dark:bg-zinc-800 gap-1 shrink-0">
            {(['58', '80', 'a5'] as const).map((size) => (
              <button
                key={size}
                type="button"
                onClick={() => handleSelectPaper(size)}
                className={`min-h-[36px] px-2.5 rounded-lg text-xs font-bold transition-colors ${
                  paper === size
                    ? 'bg-white dark:bg-zinc-900 text-red-600 dark:text-red-400 shadow-sm'
                    : 'text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white'
                }`}
              >
                {size === 'a5' ? 'A5' : `${size}mm`}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => printReceipt(note, kind, paper, receiptCatatan)}
            className="flex-1 min-h-[44px] px-4 rounded-xl bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-zinc-900 text-xs font-bold flex items-center justify-center gap-2 transition-colors"
          >
            <Printer className="w-4 h-4 shrink-0" />
            Print Langsung ({paper === 'a5' ? 'A5' : `${paper}mm`})
          </button>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        {isOwner && !note.batal && !showCancelForm ? (
          <button
            type="button"
            onClick={() => setShowCancelForm(true)}
            className="min-h-[44px] px-3 rounded-xl text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 flex items-center gap-1.5"
          >
            <Ban className="w-4 h-4" /> Batalkan nota
          </button>
        ) : (
          <div />
        )}
        <button
          type="button"
          onClick={onClose}
          className="min-h-[44px] px-5 rounded-xl border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200 text-sm font-semibold"
        >
          Tutup
        </button>
      </div>
    </Modal>
  );
}
