import { CheckCircle2, AlertTriangle, XCircle, Info, X } from 'lucide-react';

export interface ToastItem {
  id: string;
  message: string;
  type?: 'ok' | 'warn' | 'err' | 'info';
  actionLabel?: string;
  onAction?: () => void;
}

interface ToastContainerProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed top-4 right-4 left-4 sm:left-auto z-[100] flex flex-col gap-2 sm:max-w-sm pointer-events-none pt-safe"
      aria-live="polite"
    >
      {toasts.map((t) => {
        const icon =
          t.type === 'ok' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : t.type === 'err' ? (
            <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
          ) : t.type === 'warn' ? (
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          ) : (
            <Info className="w-4 h-4 text-red-400 shrink-0" />
          );

        return (
          <div
            key={t.id}
            className="pointer-events-auto flex items-center gap-3 rounded-2xl bg-zinc-900 dark:bg-zinc-800 text-white px-4 py-3 text-sm shadow-xl border border-zinc-700/80"
          >
            {icon}
            <span className="flex-1 leading-snug">{t.message}</span>
            {t.onAction && (
              <button
                type="button"
                onClick={() => {
                  onDismiss(t.id);
                  t.onAction?.();
                }}
                className="shrink-0 rounded-lg bg-red-600 hover:bg-red-500 px-3 py-1.5 text-xs font-semibold text-white whitespace-nowrap transition-colors"
              >
                {t.actionLabel || 'Buka'}
              </button>
            )}
            <button
              type="button"
              onClick={() => onDismiss(t.id)}
              className="shrink-0 p-1 rounded-lg text-zinc-400 hover:text-white transition-colors"
              aria-label="Tutup notifikasi"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
