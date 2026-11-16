import { useEffect, useMemo, useRef, useState } from 'react';
import { BrowserQRCodeReader, BrowserQRCodeSvgWriter } from '@zxing/browser';
import { EncodeHintType } from '@zxing/library';
import {
  Camera,
  CheckCircle2,
  Copy,
  ImageUp,
  Loader2,
  QrCode,
  Settings2,
} from 'lucide-react';
import { copyToClipboard, rp } from '../../utils/format';
import { generateDynamicQris, parseQrisInfo } from '../../utils/qris';
import { BarcodeModal } from './BarcodeModal';
import { Modal } from './Dialog';

interface QrisModalProps {
  totalAmount: number;
  storeQris: string;
  isOwner: boolean;
  savingSale: boolean;
  onSaveStoreQris: (nextQris: string) => Promise<void>;
  onConfirmPaid: () => void;
  onToast: (msg: string, type?: 'ok' | 'warn' | 'err' | 'info') => void;
  onClose: () => void;
}

export function QrisModal({
  totalAmount,
  storeQris,
  isOwner,
  savingSale,
  onSaveStoreQris,
  onConfirmPaid,
  onToast,
  onClose,
}: QrisModalProps) {
  const [amount, setAmount] = useState<number>(() => Math.max(0, Math.round(totalAmount)));
  const [configuring, setConfiguring] = useState<boolean>(() => !storeQris);
  const [draftQris, setDraftQris] = useState<string>(storeQris);
  const [savingConfig, setSavingConfig] = useState(false);
  const [scanningQris, setScanningQris] = useState(false);
  const [decodingImg, setDecodingImg] = useState(false);

  const qrContainerRef = useRef<HTMLDivElement | null>(null);
  const imgInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setDraftQris(storeQris);
    if (!storeQris) {
      setConfiguring(true);
    }
  }, [storeQris]);

  const activeQris = storeQris.trim();

  const dynamicInfo = useMemo(() => {
    if (!activeQris) return null;
    try {
      const info = parseQrisInfo(activeQris);
      const payload = generateDynamicQris(activeQris, amount);
      return {
        ...info,
        payload,
      };
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : 'Format QRIS tidak valid.',
      };
    }
  }, [activeQris, amount]);

  const draftPreview = useMemo(() => {
    if (!draftQris.trim()) return null;
    try {
      return { info: parseQrisInfo(draftQris) };
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Format QRIS tidak valid.' };
    }
  }, [draftQris]);

  // Render crisp SVG QR code locally via ZXing BrowserQRCodeSvgWriter
  useEffect(() => {
    const container = qrContainerRef.current;
    if (!container) return;
    container.innerHTML = '';

    if (!dynamicInfo || 'error' in dynamicInfo) return;

    try {
      const writer = new BrowserQRCodeSvgWriter();
      const hints = new Map<EncodeHintType, unknown>();
      hints.set(EncodeHintType.MARGIN, 1);
      const svg = writer.write(dynamicInfo.payload, 260, 260, hints);
      svg.setAttribute('viewBox', '0 0 260 260');
      svg.setAttribute('class', 'w-full h-full');
      svg.style.width = '100%';
      svg.style.height = '100%';
      svg.style.display = 'block';
      container.appendChild(svg);
    } catch {
      // handled gracefully
    }
  }, [dynamicInfo, configuring]);

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draftQris.trim()) {
      onToast('Tempel atau scan kode QRIS statis toko terlebih dahulu', 'warn');
      return;
    }
    if (draftPreview && 'error' in draftPreview && draftPreview.error) {
      onToast(draftPreview.error, 'err');
      return;
    }
    setSavingConfig(true);
    try {
      await onSaveStoreQris(draftQris.trim());
      setConfiguring(false);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal menyimpan QRIS toko', 'err');
    } finally {
      setSavingConfig(false);
    }
  };

  const handleUploadQrImage = async (file: File) => {
    setDecodingImg(true);
    const objectUrl = URL.createObjectURL(file);
    try {
      const reader = new BrowserQRCodeReader();
      const result = await reader.decodeFromImageUrl(objectUrl);
      const text = result.getText().trim();
      parseQrisInfo(text);
      setDraftQris(text);
      onToast('Kode QRIS berhasil dibaca dari gambar', 'ok');
    } catch (err) {
      onToast(
        err instanceof Error && err.message.includes('QRIS')
          ? err.message
          : 'Gagal membaca QRIS dari gambar. Pastikan foto QR terlihat jelas.',
        'err',
      );
    } finally {
      URL.revokeObjectURL(objectUrl);
      setDecodingImg(false);
      if (imgInputRef.current) imgInputRef.current.value = '';
    }
  };

  if (scanningQris) {
    return (
      <BarcodeModal
        onDetected={(code) => {
          try {
            const info = parseQrisInfo(code);
            setDraftQris(info.cleanedPayload);
            setScanningQris(false);
            onToast(`QRIS "${info.merchantName}" berhasil dipindai`, 'ok');
            return { ok: true, message: `QRIS terdeteksi: ${info.merchantName}` };
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'Bukan kode QRIS yang valid';
            onToast(msg, 'warn');
            return { ok: false, message: msg };
          }
        }}
        onClose={() => setScanningQris(false)}
      />
    );
  }

  const canRenderQr = Boolean(dynamicInfo && !('error' in dynamicInfo));

  return (
    <Modal title="Pembayaran QRIS Dinamis" onClose={onClose} maxWidth="max-w-md">
      {configuring ? (
        <form onSubmit={handleSaveConfig} className="space-y-4">
          <div className="p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/70 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">
            {isOwner
              ? 'Masukkan atau pindai kode QRIS statis toko Anda satu kali. Setelah disimpan, semua perangkat kasir dapat membuat QRIS dengan nominal tagihan otomatis.'
              : 'QRIS toko belum diatur. Minta Owner mengatur kode QRIS toko dari menu transaksi ini.'}
          </div>

          {isOwner && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setScanningQris(true)}
                  className="min-h-[42px] px-3 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-700 text-xs font-semibold flex items-center justify-center gap-1.5"
                >
                  <Camera className="w-4 h-4 text-red-600 dark:text-red-400" />
                  <span>Scan Stiker QRIS</span>
                </button>
                <button
                  type="button"
                  disabled={decodingImg}
                  onClick={() => imgInputRef.current?.click()}
                  className="min-h-[42px] px-3 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-700 text-xs font-semibold flex items-center justify-center gap-1.5 disabled:opacity-60"
                >
                  {decodingImg ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <ImageUp className="w-4 h-4 text-red-600 dark:text-red-400" />
                  )}
                  <span>Upload Gambar QR</span>
                </button>
                <input
                  ref={imgInputRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleUploadQrImage(f);
                  }}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-300 mb-1">
                  String QRIS Statis (EMVCo)
                </label>
                <textarea
                  rows={4}
                  value={draftQris}
                  onChange={(e) => setDraftQris(e.target.value)}
                  placeholder="Tempel teks QRIS toko (diawali 000201...)"
                  className="w-full p-3 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-data focus:outline-none focus:ring-2 focus:ring-red-600"
                />
              </div>

              {draftPreview && 'info' in draftPreview && draftPreview.info && (
                <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-300">
                  <div className="font-bold">QRIS Valid Terdeteksi</div>
                  <div className="mt-0.5">
                    Merchant: <strong>{draftPreview.info.merchantName}</strong>
                    {draftPreview.info.merchantCity ? ` (${draftPreview.info.merchantCity})` : ''}
                  </div>
                  {draftPreview.info.nmid && (
                    <div className="font-data mt-0.5">NMID: {draftPreview.info.nmid}</div>
                  )}
                </div>
              )}

              {draftPreview && 'error' in draftPreview && (
                <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs font-medium text-rose-700 dark:text-rose-300">
                  {draftPreview.error}
                </div>
              )}
            </>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            {storeQris && (
              <button
                type="button"
                onClick={() => setConfiguring(false)}
                className="min-h-[42px] px-4 rounded-xl border border-zinc-300 dark:border-zinc-700 text-sm font-semibold"
              >
                Kembali
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="min-h-[42px] px-4 rounded-xl border border-zinc-300 dark:border-zinc-700 text-sm font-semibold"
            >
              Tutup
            </button>
            {isOwner && (
              <button
                type="submit"
                disabled={savingConfig || Boolean(draftPreview && 'error' in draftPreview && draftPreview.error)}
                className="min-h-[42px] px-4 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-semibold shadow-sm shadow-red-600/20"
              >
                {savingConfig ? 'Menyimpan...' : 'Simpan & Tampilkan QR'}
              </button>
            )}
          </div>
        </form>
      ) : (
        <div className="space-y-4">
          {dynamicInfo && 'error' in dynamicInfo ? (
            <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-sm text-rose-700 dark:text-rose-300">
              {dynamicInfo.error}
            </div>
          ) : (
            dynamicInfo && (
              <div className="rounded-2xl bg-white text-zinc-950 border border-zinc-200 shadow-sm p-4 sm:p-5 flex flex-col items-center text-center">
                <div className="w-full flex items-center justify-between gap-2 pb-3 mb-3 border-b border-zinc-200">
                  <div className="flex items-center gap-1.5">
                    <span className="px-2 py-0.5 rounded bg-zinc-950 text-white text-xs font-extrabold tracking-wider">
                      QRIS
                    </span>
                    <span className="text-[11px] font-semibold text-zinc-500">
                      Dinamis
                    </span>
                  </div>
                  {dynamicInfo.nmid && (
                    <span className="text-[11px] font-data text-zinc-500 truncate max-w-[180px]">
                      NMID: {dynamicInfo.nmid}
                    </span>
                  )}
                </div>

                <div className="text-sm font-extrabold text-zinc-900 leading-tight">
                  {dynamicInfo.merchantName}
                </div>
                {dynamicInfo.merchantCity && (
                  <div className="text-xs text-zinc-500 mt-0.5">{dynamicInfo.merchantCity}</div>
                )}

                <div className="mt-3 px-4 py-2 rounded-xl bg-red-50 border border-red-200/80">
                  <div className="text-[11px] font-semibold text-red-700 uppercase tracking-wider">
                    Nominal Tagihan
                  </div>
                  <div className="text-2xl font-extrabold font-data text-red-700">
                    {rp(amount)}
                  </div>
                </div>

                <div className="mt-4 p-3 rounded-2xl bg-white border-2 border-zinc-900/10 w-56 h-56 sm:w-64 sm:h-64 flex items-center justify-center">
                  <div ref={qrContainerRef} className="w-full h-full" />
                </div>

                <p className="mt-3 text-[11px] text-zinc-500 leading-relaxed max-w-xs">
                  Pindai kode QR di atas menggunakan mobile banking atau e-wallet (GoPay, OVO, DANA, ShopeePay, BCA, BRI, Mandiri, dll).
                </p>
              </div>
            )
          )}

          {/* Optional custom amount adjustment for split payments */}
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <label className="block text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 mb-1">
                Ubah Nominal QRIS (jika bayar sebagian)
              </label>
              <input
                type="number"
                min={0}
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(Math.max(0, Math.round(Number(e.target.value) || 0)))}
                className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm font-data focus:outline-none focus:ring-2 focus:ring-red-600"
              />
            </div>
            {amount !== Math.round(totalAmount) && (
              <button
                type="button"
                onClick={() => setAmount(Math.max(0, Math.round(totalAmount)))}
                className="self-end min-h-[40px] px-3 rounded-xl border border-zinc-300 dark:border-zinc-700 text-xs font-semibold hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                Sesuai Total
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex items-center gap-1.5">
              {canRenderQr && dynamicInfo && !('error' in dynamicInfo) && (
                <button
                  type="button"
                  onClick={async () => {
                    const ok = await copyToClipboard(dynamicInfo.payload);
                    onToast(ok ? 'Payload QRIS disalin' : 'Gagal menyalin', ok ? 'ok' : 'err');
                  }}
                  className="min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-semibold text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 inline-flex items-center gap-1.5"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Salin</span>
                </button>
              )}
              {isOwner && (
                <button
                  type="button"
                  onClick={() => setConfiguring(true)}
                  className="min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-semibold text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 inline-flex items-center gap-1.5"
                >
                  <Settings2 className="w-3.5 h-3.5" />
                  <span>Atur QRIS</span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 ml-auto">
              <button
                type="button"
                onClick={onClose}
                className="min-h-[42px] px-3.5 rounded-xl border border-zinc-300 dark:border-zinc-700 text-sm font-semibold"
              >
                Tutup
              </button>
              {canRenderQr && (
                <button
                  type="button"
                  disabled={savingSale}
                  onClick={onConfirmPaid}
                  className="min-h-[42px] px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 disabled:opacity-60 text-white text-sm font-bold inline-flex items-center gap-1.5 shadow-sm shadow-emerald-600/20"
                >
                  {savingSale ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4" />
                  )}
                  <span>{savingSale ? 'Menyimpan...' : 'Sudah Bayar & Simpan'}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

export { QrCode };
