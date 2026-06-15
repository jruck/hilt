"use client";

import { useCallback, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";
import type { VirtualItem, Virtualizer } from "@tanstack/react-virtual";

interface VirtualFeedRowProps<TScrollElement extends Element | Window> {
  virtualizer: Virtualizer<TScrollElement, HTMLDivElement>;
  virtualRow: VirtualItem;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

export function VirtualFeedRow<TScrollElement extends Element | Window>({
  virtualizer,
  virtualRow,
  className = "",
  style,
  children,
}: VirtualFeedRowProps<TScrollElement>) {
  const rowRef = useRef<HTMLDivElement | null>(null);

  const setRowRef = useCallback((node: HTMLDivElement | null) => {
    rowRef.current = node;
    virtualizer.measureElement(node);
  }, [virtualizer]);

  useLayoutEffect(() => {
    const row = rowRef.current;
    const ResizeObserverCtor = row?.ownerDocument.defaultView?.ResizeObserver;
    if (!row || !ResizeObserverCtor) return;

    let frame: number | null = null;
    const measure = () => {
      if (frame !== null) row.ownerDocument.defaultView?.cancelAnimationFrame(frame);
      frame = row.ownerDocument.defaultView?.requestAnimationFrame(() => {
        frame = null;
        if (row.isConnected) virtualizer.measureElement(row);
      }) ?? null;
    };

    virtualizer.measureElement(row);
    const observer = new ResizeObserverCtor(measure);
    observer.observe(row);
    return () => {
      if (frame !== null) row.ownerDocument.defaultView?.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [virtualizer, virtualRow.key]);

  return (
    <div
      ref={setRowRef}
      data-index={virtualRow.index}
      className={`absolute left-0 top-0 w-full ${className}`}
      style={{ ...style, transform: `translateY(${virtualRow.start}px)` }}
    >
      {children}
    </div>
  );
}
