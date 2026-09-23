"use client";

import { useEffect, useRef, useCallback } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useFocusLock(
  containerRef: React.RefObject<HTMLElement>,
  onEscape?: () => void
) {
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Set scroll lock
    document.body.style.overflow = "hidden";

    const focusable = container.querySelectorAll<HTMLElement>(FOCUSABLE);
    const firstFocusable = focusable[0];
    const lastFocusable = focusable[focusable.length - 1];

    const handleEscape = useCallback(
      (e: KeyboardEvent) => {
        if (e.key === "Escape" && onEscape) {
          onEscape();
        }
      },
      [onEscape]
    );

    const trapFocus = useCallback(
      (e: KeyboardEvent) => {
        if (e.key !== "Tab" || !containerRef.current) return;
        const focusable = containerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE);
        if (focusable.length === 0) return;

        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      },
      [containerRef]
    );

    const handleKey = useCallback((e: KeyboardEvent) => {
      handleEscape(e);
      trapFocus(e);
    }, [handleEscape, trapFocus]);

    document.addEventListener("keydown", handleKey);

    previousFocusRef.current = document.activeElement as HTMLElement;

    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = "";
      previousFocusRef.current?.focus();
    };
  }, [containerRef, onEscape]);

  return undefined;
}