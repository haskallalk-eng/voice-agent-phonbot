import React, { createContext, useContext, useState, useCallback } from 'react';
import { IconStar, IconPhone, IconCapabilities } from './PhonbotIcons.js';

type ToastType = 'success' | 'error' | 'info';
type Toast = { id: number; type: ToastType; message: string };

const ToastContext = createContext<{ toast: (type: ToastType, message: string) => void }>({ toast: () => {} });

let toastId = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((type: ToastType, message: string) => {
    const id = ++toastId;
    setToasts((t) => [...t, { id, type, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            onClick={() => dismiss(t.id)}
            className={`pointer-events-auto cursor-pointer px-4 py-3 rounded-xl text-sm font-medium shadow-lg backdrop-blur-xl border transition-all ${
              t.type === 'success' ? 'bg-green-500/20 text-green-300 border-green-500/30' :
              t.type === 'error' ? 'bg-red-500/20 text-red-300 border-red-500/30' :
              'bg-white/10 text-white/80 border-white/20'
            }`}
          >
            <span className="inline-flex items-center gap-1.5">
              {t.type === 'success' ? <IconStar size={14} /> : t.type === 'error' ? <IconCapabilities size={14} /> : <IconPhone size={14} />}
              {t.message}
            </span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
