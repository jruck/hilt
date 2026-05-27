"use client";

import { useEffect } from "react";

const SCROLLBAR_ACTIVE_CLASS = "hilt-scrollbar-active";
const SCROLLBAR_FADE_MS = 700;

function getScrollableElement(target: EventTarget | null): HTMLElement | null {
  if (target instanceof HTMLElement) return target;
  if (target === document) return document.scrollingElement as HTMLElement | null;
  return null;
}

export function ScrollbarVisibilityController() {
  useEffect(() => {
    const timers = new Map<HTMLElement, number>();

    const markScrolling = (target: EventTarget | null) => {
      const element = getScrollableElement(target);
      if (!element) return;

      element.classList.add(SCROLLBAR_ACTIVE_CLASS);

      const existingTimer = timers.get(element);
      if (existingTimer !== undefined) window.clearTimeout(existingTimer);

      const timer = window.setTimeout(() => {
        element.classList.remove(SCROLLBAR_ACTIVE_CLASS);
        timers.delete(element);
      }, SCROLLBAR_FADE_MS);

      timers.set(element, timer);
    };

    const handleScroll = (event: Event) => {
      markScrolling(event.target);
    };

    document.addEventListener("scroll", handleScroll, { capture: true, passive: true });

    return () => {
      document.removeEventListener("scroll", handleScroll, true);
      timers.forEach((timer, element) => {
        window.clearTimeout(timer);
        element.classList.remove(SCROLLBAR_ACTIVE_CLASS);
      });
      timers.clear();
    };
  }, []);

  return null;
}
