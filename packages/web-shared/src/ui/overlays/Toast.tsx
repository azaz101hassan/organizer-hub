"use client";

import {
  createContext,
  useCallback,
  useContext,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ToastTone = "default" | "success" | "error";

export interface ToastItem {
  id: string;
  message: string;
  tone: ToastTone;
}

interface ToastContextValue {
  toast: (message: string, tone?: ToastTone) => void;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const ToastContext = createContext<ToastContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  // Use a ref-based counter to generate stable IDs without needing useId in
  // the imperative callback (useId can only be called at the top level).
  const counterRef = useRef(0);

  const toast = useCallback((message: string, tone: ToastTone = "default") => {
    const id = `toast-${++counterRef.current}`;
    setToasts((prev) => [...prev, { id, message, tone }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {toasts.length > 0 && (
        <div
          role="status"
          aria-live="polite"
          aria-atomic="false"
          style={{
            position: "fixed",
            bottom: 24,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 80,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 8,
            pointerEvents: "none",
          }}
        >
          {toasts.map((t) => (
            <ToastChip key={t.id} item={t} />
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Internal chip
// ---------------------------------------------------------------------------

function ToastChip({ item }: { item: ToastItem }) {
  const toneStyle: Record<ToastTone, React.CSSProperties> = {
    default: {
      background: "var(--ink)",
      color: "var(--bg)",
    },
    success: {
      background: "var(--good)",
      color: "var(--bg)",
    },
    error: {
      background: "var(--bad)",
      color: "var(--bg)",
    },
  };

  return (
    <div
      className="toast"
      style={{
        ...toneStyle[item.tone],
        // Override the default `.toast` fixed position — the wrapper div above
        // handles positioning. We only reuse the padding/radius/font tokens.
        position: "relative",
        bottom: "auto",
        left: "auto",
        transform: "none",
        animation: "toastIn .3s ease both",
        pointerEvents: "auto",
      }}
    >
      {item.message}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used inside <ToastProvider>");
  }
  return ctx;
}
