"use client";

import { createContext, useContext, ReactNode } from "react";
import { useEventSocket } from "@/hooks/useEventSocket";

type EventHandler = (data: unknown) => void;

interface EventSocketContextValue {
  connected: boolean;
  clientId: string | null;
  subscribe: (channel: string, params?: Record<string, unknown>) => void;
  unsubscribe: (channel: string) => void;
  on: (channel: string, event: string, handler: EventHandler) => () => void;
}

const EventSocketContext = createContext<EventSocketContextValue | null>(null);

/**
 * Provider for the EventSocket WebSocket connection.
 * Wraps the app to provide a single shared connection.
 */
export function EventSocketProvider({ children }: { children: ReactNode }) {
  const eventSocket = useEventSocket();

  return (
    <EventSocketContext.Provider value={eventSocket}>{children}</EventSocketContext.Provider>
  );
}

/**
 * Hook to access the EventSocket context.
 * Must be used within EventSocketProvider.
 */
export function useEventSocketContext() {
  const context = useContext(EventSocketContext);
  if (!context) {
    throw new Error("useEventSocketContext must be used within EventSocketProvider");
  }
  return context;
}
