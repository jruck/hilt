"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import {
  initialMobileScrollChromeState,
  reduceMobileScrollChrome,
  type MobileScrollChromeState,
} from "@/lib/mobile-scroll-chrome";

interface MobileChromeContextValue {
  isMobile: boolean;
  visible: boolean;
  hidden: boolean;
  show: () => void;
  reset: () => void;
  acquireVisibilityLock: () => () => void;
}

const MobileChromeContext = createContext<MobileChromeContextValue | null>(null);

function chromeScrollTarget(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof HTMLElement)) return null;
  return target.closest("[data-mobile-scroll-chrome]") ? target : null;
}

function scrollTopFor(element: HTMLElement): number {
  return Math.max(0, element.scrollTop);
}

export function MobileChromeProvider({
  children,
  resetKey,
}: {
  children: ReactNode;
  resetKey: string;
}) {
  const isMobile = useIsMobile();
  const [visible, setVisibleState] = useState(true);
  const visibleRef = useRef(true);
  const reducerStateRef = useRef<MobileScrollChromeState>(initialMobileScrollChromeState(true));
  const activeTargetRef = useRef<HTMLElement | null>(null);
  const lockCountRef = useRef(0);

  const setVisible = useCallback((next: boolean) => {
    visibleRef.current = next;
    reducerStateRef.current = {
      ...reducerStateRef.current,
      visible: next,
    };
    setVisibleState(next);
  }, []);

  const show = useCallback(() => {
    setVisible(true);
  }, [setVisible]);

  const reset = useCallback(() => {
    activeTargetRef.current = null;
    reducerStateRef.current = initialMobileScrollChromeState(true);
    setVisible(true);
  }, [setVisible]);

  const acquireVisibilityLock = useCallback(() => {
    lockCountRef.current += 1;
    show();

    let released = false;
    return () => {
      if (released) return;
      released = true;
      lockCountRef.current = Math.max(0, lockCountRef.current - 1);
    };
  }, [show]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(reset);
    return () => window.cancelAnimationFrame(frame);
  }, [reset, resetKey]);

  useEffect(() => {
    if (!isMobile) {
      const frame = window.requestAnimationFrame(reset);
      return () => window.cancelAnimationFrame(frame);
    }

    const handleScroll = (event: Event) => {
      const target = chromeScrollTarget(event.target);
      if (!target) return;

      const scrollTop = scrollTopFor(target);
      if (activeTargetRef.current !== target) {
        activeTargetRef.current = target;
        reducerStateRef.current = initialMobileScrollChromeState(visibleRef.current, scrollTop);
        return;
      }

      if (lockCountRef.current > 0) {
        show();
        reducerStateRef.current = initialMobileScrollChromeState(true, scrollTop);
        return;
      }

      const next = reduceMobileScrollChrome(reducerStateRef.current, {
        scrollTop,
        canHide: true,
      });
      reducerStateRef.current = next;

      if (next.visible !== visibleRef.current) {
        setVisible(next.visible);
      }
    };

    document.addEventListener("scroll", handleScroll, { capture: true, passive: true });
    return () => document.removeEventListener("scroll", handleScroll, true);
  }, [isMobile, reset, setVisible, show]);

  const value = useMemo<MobileChromeContextValue>(() => ({
    isMobile,
    visible,
    hidden: isMobile && !visible,
    show,
    reset,
    acquireVisibilityLock,
  }), [acquireVisibilityLock, isMobile, reset, show, visible]);

  return (
    <MobileChromeContext.Provider value={value}>
      {children}
    </MobileChromeContext.Provider>
  );
}

export function useMobileChrome(): MobileChromeContextValue {
  const value = useContext(MobileChromeContext);
  if (!value) {
    throw new Error("useMobileChrome must be used inside MobileChromeProvider");
  }
  return value;
}

export function useMobileChromeVisibilityLock(active: boolean) {
  const { acquireVisibilityLock, isMobile } = useMobileChrome();

  useEffect(() => {
    if (!active || !isMobile) return undefined;
    return acquireVisibilityLock();
  }, [acquireVisibilityLock, active, isMobile]);
}

export function MobileChromeTopBar({
  children,
  className = "",
  enabled = true,
}: {
  children: ReactNode;
  className?: string;
  enabled?: boolean;
}) {
  const { hidden, isMobile } = useMobileChrome();
  const active = isMobile && enabled;
  const concealed = active && hidden;

  return (
    <div
      data-mobile-chrome-animated
      data-mobile-chrome-top
      data-mobile-chrome-state={concealed ? "hidden" : "visible"}
      style={active ? { transform: concealed ? "translateY(calc(-100% - 8px))" : "translateY(0)" } : undefined}
      className={`${active ? "absolute left-0 right-0 top-0 z-30 bg-[var(--bg-primary)] transition-[transform,opacity] duration-200 ease-out will-change-transform" : "relative"} ${
        concealed ? "pointer-events-none opacity-0" : "opacity-100"
      } ${className}`}
    >
      {children}
    </div>
  );
}

export function MobileChromeContent({
  children,
  className = "",
  inactiveClassName = "",
  enabled = true,
  offset = "var(--hilt-mobile-top-chrome-height)",
}: {
  children: ReactNode;
  className?: string;
  inactiveClassName?: string;
  enabled?: boolean;
  offset?: string;
}) {
  const { hidden, isMobile } = useMobileChrome();
  const active = isMobile && enabled;

  const style = active ? ({
    "--hilt-mobile-top-chrome-offset": offset,
    "--hilt-mobile-chrome-overshoot": "var(--hilt-mobile-top-chrome-offset)",
    top: "var(--hilt-mobile-top-chrome-offset)",
    bottom: "calc(0px - var(--hilt-mobile-top-chrome-offset))",
    transform: hidden ? "translateY(calc(0px - var(--hilt-mobile-top-chrome-offset)))" : "translateY(0)",
  } as CSSProperties & {
    "--hilt-mobile-top-chrome-offset": string;
    "--hilt-mobile-chrome-overshoot": string;
  }) : undefined;

  return (
    <div
      data-mobile-chrome-animated
      data-mobile-chrome-content
      data-mobile-chrome-state={active && hidden ? "hidden" : "visible"}
      style={style}
      className={`${active ? "absolute left-0 right-0 transition-transform duration-200 ease-out will-change-transform" : "relative"} ${className} ${
        active ? "" : inactiveClassName
      }`}
    >
      {children}
    </div>
  );
}
