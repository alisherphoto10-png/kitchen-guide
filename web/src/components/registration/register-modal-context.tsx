"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

interface RegisterModalContextValue {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

const RegisterModalContext = createContext<RegisterModalContextValue | null>(null);

export function RegisterModalProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const value = useMemo(() => ({ isOpen, open, close }), [isOpen, open, close]);

  return <RegisterModalContext.Provider value={value}>{children}</RegisterModalContext.Provider>;
}

export function useRegisterModal() {
  const ctx = useContext(RegisterModalContext);
  if (!ctx) {
    throw new Error("useRegisterModal must be used within RegisterModalProvider");
  }
  return ctx;
}
