"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DropdownContextValue {
  open: boolean;
  toggle: () => void;
  close: () => void;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const DropdownContext = createContext<DropdownContextValue | null>(null);

function useDropdown(): DropdownContextValue {
  const ctx = useContext(DropdownContext);
  if (!ctx) throw new Error("DropdownMenu subcomponents must be used inside <DropdownMenu>");
  return ctx;
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

export function DropdownMenu({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((v) => !v), []);
  const close = useCallback(() => setOpen(false), []);

  return (
    <DropdownContext.Provider value={{ open, toggle, close }}>
      <div style={{ position: "relative", display: "inline-block" }} className={className}>
        {children}
      </div>
    </DropdownContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Trigger
// ---------------------------------------------------------------------------

export function DropdownTrigger({ children }: { children: ReactNode }) {
  const { toggle } = useDropdown();
  return (
    <div onClick={toggle} style={{ display: "contents" }}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Content (panel)
// ---------------------------------------------------------------------------

export function DropdownContent({
  children,
  anchor = "right",
  className,
}: {
  children: ReactNode;
  anchor?: "left" | "right";
  className?: string;
}) {
  const { open, close } = useDropdown();
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onPointer(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        close();
      }
    }
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open, close]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open) return null;

  return (
    <>
      {/* click-trap overlay — sits behind the panel but above the topbar */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 50,
        }}
        aria-hidden="true"
        onClick={close}
      />
      <div
        ref={ref}
        className={`ad__menu${className ? ` ${className}` : ""}`}
        style={{ [anchor === "left" ? "left" : "right"]: 18 } as React.CSSProperties}
      >
        {children}
      </div>
    </>
  );
}
