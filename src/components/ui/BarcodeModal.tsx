import { useCallback, useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';
import {
  Camera,
  CheckCircle2,
  Flashlight,
  RefreshCw,
  ScanBarcode,
  XCircle,
} from 'lucide-react';
import { Modal } from './Dialog';

export interface ScanFeedback {
  ok: boolean;
  message: string;
}

interface BarcodeModalProps {
  allowContinuous?: boolean;
  onDetected: (code: string, isContinuous: boolean) => ScanFeedback | void;
  onClose: () => void;
}

function playBeep(success: boolean) {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = success ? 'sine' : 'triangle';
    osc.frequency.value = success ? 1046.5 : 320;
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (success ? 0.12 : 0.22));
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + (success ? 0.13 : 0.23));
    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 300);
  } catch {
    // ignore audio restriction errors
  }
}

export function BarcodeModal({
  allowContinuous = false,
  onDetected,
  onClose,
}: BarcodeModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const lastCodeRef = useRef<{ code: string; time: number }>({ code: '', time: 0 });

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [continuous, setContinuous] = useState(false);
  const [feedback, setFeedback] = useState<ScanFeedback | null>(null);
  const [error, setError] = useState<string>('');
  const [starting, setStarting] = useState(true);
  const [manualCode, setManualCode] = useState('');

  const continuousRef = useRef(continuous);
  continuousRef.current = continuous;
  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;

  const stopScanner = useCallback(() => {
    try {
      controlsRef.current?.stop();
    } catch {
      // ignore stop errors
    }
    controlsRef.current = null;
    try {
      BrowserMultiFormatReader.releaseAllStreams();
    } catch {
      // ignore release errors
    }
    setTorchOn(false);
    setTorchSupported(false);
  }, []);

  const handleDecodedCode = useCallback((rawCode: string) => {
    const code = rawCode.trim();
    if (!code) return;

    const now = Date.now();
    if (
      lastCodeRef.current.code === code &&
      now - lastCodeRef.current.time < 1500
    ) {
      return;
    }
    lastCodeRef.current = { code, time: now };

    const isCont = continuousRef.current;
    const result = onDetectedRef.current(code, isCont);
    const ok = result ? result.ok : true;
    playBeep(ok);

    if (isCont) {
      setFeedback(
        result || {
          ok: true,
          message: `Terbaca: ${code}`,
        },
      );
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function startCamera() {
      setStarting(true);
      setError('');
      stopScanner();

      if (!navigator.mediaDevices?.getUserMedia) {
        setError(
          'Kamera tidak tersedia di browser ini. Pastikan membuka aplikasi via HTTPS atau gunakan input manual di bawah.',
        );
        setStarting(false);
        return;
      }

      try {
        const reader = new BrowserMultiFormatReader();

        const onResult = (result: { getText: () => string } | undefined) => {
          if (cancelled || !result) return;
          handleDecodedCode(result.getText());
        };

        const controls = selectedDeviceId
          ? await reader.decodeFromVideoDevice(
              selectedDeviceId,
              videoRef.current || undefined,
              onResult,
            )
          : await reader.decodeFromConstraints(
              {
                video: {
                  facingMode: { ideal: 'environment' },
                  width: { ideal: 1280 },
                  height: { ideal: 720 },
                },
              },
              videoRef.current || undefined,
              onResult,
            );

        if (cancelled) {
          controls.stop();
          return;
        }

        controlsRef.current = controls;
        setStarting(false);

        // Check torch capability if available
        try {
          const caps = controls.streamVideoCapabilitiesGet?.((t) => [t]) as
            | (MediaTrackCapabilities & { torch?: boolean })
            | undefined;
          setTorchSupported(!!caps?.torch && typeof controls.switchTorch === 'function');
        } catch {
          setTorchSupported(false);
        }

        // Enumerate cameras after permission is granted
        try {
          const list = await BrowserMultiFormatReader.listVideoInputDevices();
          if (!cancelled) {
            setDevices(list);
          }
        } catch {
          // ignore device enumeration errors
        }
      } catch (err) {
        if (cancelled) return;
        const msg = (err as Error)?.message || '';
        if (/permission|denied|notallowed/i.test(msg)) {
          setError(
            'Izin kamera ditolak. Aktifkan izin kamera pada browser Anda atau ketik kode barcode secara manual di bawah.',
          );
        } else {
          setError(
            'Kamera tidak dapat dimulai. Pastikan tidak sedang dipakai aplikasi lain, atau ketik kode manual di bawah.',
          );
        }
        setStarting(false);
      }
    }

    startCamera();

    return () => {
      cancelled = true;
      stopScanner();
    };
  }, [selectedDeviceId, handleDecodedCode, stopScanner]);

  const handleToggleTorch = async () => {
    if (!controlsRef.current?.switchTorch) return;
    try {
      const next = !torchOn;
      await controlsRef.current.switchTorch(next);
      setTorchOn(next);
    } catch {
      setTorchSupported(false);
    }
  };

  const handleSwitchCamera = () => {
    if (devices.length < 2) return;
    const currentIndex = devices.findIndex((d) => d.deviceId === selectedDeviceId);
    const nextIndex = (currentIndex + 1) % devices.length;
    setSelectedDeviceId(devices[nextIndex].deviceId);
  };

  return (
    <Modal title="Scan Barcode Kamera" onClose={onClose} maxWidth="max-w-md">
      <div className="space-y-3.5">
        {allowContinuous && (
          <div className="flex items-center justify-between gap-2 p-1 rounded-xl bg-zinc-100 dark:bg-zinc-800">
            <button
              type="button"
              onClick={() => {
                setContinuous(false);
                setFeedback(null);
              }}
              className={`flex-1 min-h-[38px] px-3 rounded-lg text-xs font-semibold transition-colors ${
                !continuous
                  ? 'bg-white dark:bg-zinc-900 text-red-600 dark:text-red-400 shadow-sm'
                  : 'text-zinc-600 dark:text-zinc-300'
              }`}
            >
              Scan 1× (Tutup Otomatis)
            </button>
            <button
              type="button"
              onClick={() => setContinuous(true)}
              className={`flex-1 min-h-[38px] px-3 rounded-lg text-xs font-semibold transition-colors ${
                continuous
                  ? 'bg-white dark:bg-zinc-900 text-red-600 dark:text-red-400 shadow-sm'
                  : 'text-zinc-600 dark:text-zinc-300'
              }`}
            >
              Scan Beruntun
            </button>
          </div>
        )}

        {error ? (
          <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-sm text-amber-800 dark:text-amber-200 flex items-start gap-3">
            <Camera className="w-5 h-5 shrink-0 mt-0.5" />
            <p>{error}</p>
          </div>
        ) : (
          <div className="relative overflow-hidden rounded-2xl bg-zinc-950 aspect-[4/3] border border-zinc-800">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />

            {/* Viewfinder frame & crimson scan laser */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="w-3/4 h-1/2 rounded-xl border-2 border-white/70 relative overflow-hidden shadow-[0_0_0_9999px_rgba(9,9,11,0.52)]">
                <div className="absolute inset-x-3 top-1/2 -translate-y-1/2 h-0.5 bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.95)]" />
              </div>
            </div>

            {starting && (
              <div className="absolute inset-0 bg-zinc-950/75 flex flex-col items-center justify-center gap-2 text-white text-xs font-medium">
                <ScanBarcode className="w-6 h-6 animate-pulse text-red-500" />
                <span>Membuka kamera...</span>
              </div>
            )}

            {/* Camera Controls Overlay */}
            <div className="absolute top-2.5 right-2.5 flex items-center gap-2">
              {torchSupported && (
                <button
                  type="button"
                  onClick={handleToggleTorch}
                  aria-label={torchOn ? 'Matikan lampu flash' : 'Nyalakan lampu flash'}
                  className={`min-h-[40px] min-w-[40px] rounded-xl backdrop-blur-md flex items-center justify-center transition-colors ${
                    torchOn
                      ? 'bg-amber-500 text-zinc-950'
                      : 'bg-zinc-900/75 text-white hover:bg-zinc-900'
                  }`}
                >
                  <Flashlight className="w-4 h-4" />
                </button>
              )}
              {devices.length > 1 && (
                <button
                  type="button"
                  onClick={handleSwitchCamera}
                  aria-label="Ganti kamera"
                  className="min-h-[40px] px-3 rounded-xl bg-zinc-900/75 hover:bg-zinc-900 text-white backdrop-blur-md flex items-center gap-1.5 text-xs font-semibold"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Ganti</span>
                </button>
              )}
            </div>
          </div>
        )}

        {feedback && (
          <div
            className={`p-3 rounded-xl border text-xs font-semibold flex items-center gap-2 ${
              feedback.ok
                ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300'
            }`}
          >
            {feedback.ok ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <XCircle className="w-4 h-4 shrink-0" />
            )}
            <span className="truncate">{feedback.message}</span>
          </div>
        )}

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!manualCode.trim()) return;
            handleDecodedCode(manualCode.trim());
            setManualCode('');
          }}
        >
          <input
            type="text"
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value)}
            placeholder="Atau ketik / tempel kode barcode..."
            className="flex-1 min-h-[44px] px-3.5 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm font-data focus:outline-none focus:ring-2 focus:ring-red-600"
          />
          <button
            type="submit"
            className="min-h-[44px] px-4 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold"
          >
            Tambah
          </button>
        </form>

        {continuous && (
          <button
            type="button"
            onClick={onClose}
            className="w-full min-h-[44px] rounded-xl border border-zinc-300 dark:border-zinc-700 text-sm font-semibold text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            Selesai Scanning
          </button>
        )}
      </div>
    </Modal>
  );
}
