"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Icon } from "./Icon";

/** The native <dialog> gives focus trapping, Escape and a backdrop for free. */
export function Dialog({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog ref={ref} className="dialog" onClose={onClose} aria-labelledby="dialog-title">
      {open && (
        <>
          <header className="dialog-header">
            <h2 id="dialog-title">{title}</h2>
            <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
              <Icon name="close" />
            </button>
          </header>
          {children}
        </>
      )}
    </dialog>
  );
}
