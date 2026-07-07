"use client";

/**
 * ObjectPopover (v3 unit B5) — the house popover shell, extracted from the AppHud
 * eventPopover pattern + the CalendarEventPopoverContent viewport clamp so ObjectPill
 * gets the exact same feel everywhere.
 *
 * - Anchors to the trigger's getBoundingClientRect (below the anchor, left-aligned).
 * - Viewport clamp is the CalendarEventPopoverContent.tsx clamp verbatim: maxHeight
 *   min(520, viewport - margins), then top/left clamped inside a 12px margin.
 * - Dismissal is the AppHud idiom: outside-mousedown + Escape. Mousedown inside the
 *   anchor is exempt so the pill's own click handler toggles instead of racing a close.
 * - Rendered through a portal to document.body: pills live inline in prose, and a
 *   fixed-position div must not be subject to transformed/overflow ancestors (or sit
 *   as a <div> inside a <p>).
 */
import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

interface ObjectPopoverProps {
  /** The pill button this popover anchors to. */
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
}

export function ObjectPopover({ anchorRef, onClose, children }: ObjectPopoverProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Anchor + viewport clamp (CalendarEventPopoverContent.tsx:66-84). Re-runs on resize and
  // whenever the popover's own size changes (loading skeleton → resolved card).
  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const margin = 12;
    const gap = 8;
    const clamp = () => {
      const anchor = anchorRef.current?.getBoundingClientRect();
      if (anchor) {
        wrapper.style.top = `${Math.round(anchor.bottom + gap)}px`;
        wrapper.style.left = `${Math.round(anchor.left)}px`;
      }
      wrapper.style.maxHeight = `${Math.min(520, window.innerHeight - margin * 2)}px`;
      const rect = wrapper.getBoundingClientRect();
      const top = Math.min(Math.max(rect.top, margin), Math.max(margin, window.innerHeight - rect.height - margin));
      const left = Math.min(Math.max(rect.left, margin), Math.max(margin, window.innerWidth - rect.width - margin));
      wrapper.style.top = `${Math.round(top)}px`;
      wrapper.style.left = `${Math.round(left)}px`;
    };
    clamp();
    const frame = requestAnimationFrame(clamp);
    window.addEventListener("resize", clamp);
    const observer = new ResizeObserver(clamp);
    observer.observe(wrapper);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", clamp);
      observer.disconnect();
    };
  }, [anchorRef]);

  // Dismissal (AppHud.tsx:164-184): outside-mousedown + Escape.
  useEffect(() => {
    function closeOnOutside(event: MouseEvent) {
      const target = event.target;
      if (target instanceof Node && wrapperRef.current?.contains(target)) return;
      // Let the anchor's own click handler toggle the popover instead of close-then-reopen.
      if (target instanceof Node && anchorRef.current?.contains(target)) return;
      onClose();
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [anchorRef, onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={wrapperRef}
      role="dialog"
      className="hilt-object-popover-wrapper fixed z-[100] w-[min(360px,calc(100vw-24px))]"
      data-testid="object-popover"
    >
      <div className="flex max-h-[inherit] min-h-0 flex-col overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-2xl">
        <div className="min-h-0 flex-1 overflow-y-auto p-3">{children}</div>
      </div>
    </div>,
    document.body
  );
}
