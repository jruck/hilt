"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { RefreshCw } from "lucide-react";

interface PullToRefreshProps {
  onRefresh: () => void | Promise<void>;
  children: React.ReactNode;
  /** Minimum pull distance in pixels to trigger refresh */
  threshold?: number;
  /** Maximum visual pull distance */
  maxPull?: number;
}

export function PullToRefresh({
  onRefresh,
  children,
  threshold = 80,
  maxPull = 120,
}: PullToRefreshProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const touchStartY = useRef(0);
  const isPulling = useRef(false);

  const handleTouchStart = useCallback(
    (e: TouchEvent) => {
      if (isRefreshing) return;

      // Only activate if scrolled to top
      const container = containerRef.current;
      if (!container) return;

      // Find the nearest scrollable ancestor
      let scrollParent: HTMLElement | null = container;
      while (scrollParent) {
        if (scrollParent.scrollTop > 0) return; // not at top
        const style = getComputedStyle(scrollParent);
        if (
          style.overflowY === "auto" ||
          style.overflowY === "scroll"
        ) {
          if (scrollParent.scrollTop > 0) return;
        }
        scrollParent = scrollParent.parentElement;
      }

      touchStartY.current = e.touches[0].clientY;
      isPulling.current = true;
    },
    [isRefreshing]
  );

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (!isPulling.current || isRefreshing) return;

      const currentY = e.touches[0].clientY;
      const delta = currentY - touchStartY.current;

      if (delta > 0) {
        // Apply resistance curve — gets harder to pull the further you go
        const resistance = Math.min(delta * 0.5, maxPull);
        setPullDistance(resistance);
        // Prevent default scroll when we're pulling
        if (resistance > 10) {
          e.preventDefault();
        }
      } else {
        setPullDistance(0);
        isPulling.current = false;
      }
    },
    [isRefreshing, maxPull]
  );

  const handleTouchEnd = useCallback(async () => {
    if (!isPulling.current) return;
    isPulling.current = false;

    if (pullDistance >= threshold) {
      setIsRefreshing(true);
      setPullDistance(threshold * 0.5); // Snap to a smaller position while refreshing
      try {
        await onRefresh();
      } finally {
        setIsRefreshing(false);
        setPullDistance(0);
      }
    } else {
      setPullDistance(0);
    }
  }, [pullDistance, threshold, onRefresh]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener("touchstart", handleTouchStart, { passive: true });
    container.addEventListener("touchmove", handleTouchMove, { passive: false });
    container.addEventListener("touchend", handleTouchEnd, { passive: true });

    return () => {
      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("touchmove", handleTouchMove);
      container.removeEventListener("touchend", handleTouchEnd);
    };
  }, [handleTouchStart, handleTouchMove, handleTouchEnd]);

  const isOverThreshold = pullDistance >= threshold;

  return (
    <div ref={containerRef} className="flex flex-col flex-1 overflow-hidden relative">
      {/* Pull indicator */}
      <div
        className="absolute left-0 right-0 flex items-center justify-center z-10 pointer-events-none"
        style={{
          top: 0,
          height: `${pullDistance}px`,
          transition: isPulling.current ? "none" : "height 300ms cubic-bezier(0.2, 0, 0, 1)",
          overflow: "hidden",
        }}
      >
        <div
          className="flex items-center justify-center"
          style={{
            opacity: Math.min(pullDistance / threshold, 1),
            transition: isPulling.current ? "none" : "opacity 300ms ease",
          }}
        >
          <RefreshCw
            className={`w-5 h-5 text-[var(--text-tertiary)] ${isRefreshing ? "animate-spin" : ""}`}
            style={{
              transform: isRefreshing
                ? undefined
                : `rotate(${Math.min((pullDistance / threshold) * 360, 360)}deg)`,
              transition: isPulling.current ? "none" : "transform 300ms ease",
            }}
          />
        </div>
      </div>

      {/* Content — shifts down during pull */}
      <div
        className="flex flex-col flex-1 overflow-hidden"
        style={{
          transform: `translateY(${pullDistance}px)`,
          transition: isPulling.current ? "none" : "transform 300ms cubic-bezier(0.2, 0, 0, 1)",
        }}
      >
        {children}
      </div>
    </div>
  );
}
