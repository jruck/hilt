/**
 * useEventSocket Hook Unit Tests
 *
 * These tests document the expected behavior of the useEventSocket hook.
 * To run: Install vitest/jest with @testing-library/react-hooks
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useEventSocket } from "../useEventSocket";

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((error: Event) => void) | null = null;

  constructor(public url: string) {
    // Simulate async connection
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.();
    }, 0);
  }

  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  });

  // Helper to simulate receiving a message
  receiveMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

// No port discovery: the socket URL is same-origin + base path (no explicit
// port), so the hook never fetches /api/ws-port.

describe("useEventSocket", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // @ts-expect-error - Mocking global WebSocket
    global.WebSocket = MockWebSocket;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe("connection", () => {
    it("connects on mount", async () => {
      // Hook should automatically connect when mounted
      // const { result } = renderHook(() => useEventSocket());
      // await act(async () => { vi.runAllTimers(); });
      // expect(result.current.connected).toBe(true);
    });

    it("sets connected state when open", async () => {
      // connected should be false initially, then true after WebSocket opens
    });

    it("stores clientId from server", async () => {
      // After receiving { type: 'connected', clientId: 'abc' },
      // clientId should be stored in state
    });

    it("reconnects on close with exponential backoff", async () => {
      // When WebSocket closes:
      // - First reconnect after 1000ms
      // - Second reconnect after 2000ms
      // - Third reconnect after 4000ms
      // - Max delay: 30000ms
    });

    it("cleans up on unmount", () => {
      // When hook unmounts:
      // - WebSocket should be closed
      // - Reconnection timeout should be cleared
    });

    it("does not reconnect after unmount", () => {
      // If component unmounts during reconnect delay,
      // the reconnection should be cancelled
    });
  });

  describe("subscriptions", () => {
    it("sends subscribe message", async () => {
      // subscribe('bridge', { scope: '/path' }) should send:
      // { type: 'subscribe', channel: 'bridge', params: { scope: '/path' } }
    });

    it("sends unsubscribe message", async () => {
      // unsubscribe('bridge') should send:
      // { type: 'unsubscribe', channel: 'bridge' }
    });

    it("tracks pending subscriptions for reconnection", async () => {
      // If subscribe is called, and WebSocket disconnects/reconnects,
      // the subscription should be automatically re-sent
    });

    it("updates pending subscription params", async () => {
      // If subscribe is called twice for same channel with different params,
      // only the latest params should be used on reconnection
    });

    it("removes from pending on unsubscribe", async () => {
      // After unsubscribe, the subscription should be removed from pending
      // so it's not re-subscribed on reconnection
    });
  });

  describe("event handling", () => {
    it("routes events to registered handlers", async () => {
      // When server sends: { channel: 'bridge', event: 'updated', data: {...} }
      // Registered handlers for 'sessions:updated' should be called with data
    });

    it("supports multiple handlers per event", async () => {
      // Multiple handlers registered for same channel:event
      // should all be called when event is received
    });

    it("returns unsubscribe function from on()", async () => {
      // const unsub = on('bridge', 'updated', handler);
      // After unsub(), handler should no longer be called
    });

    it("does not call handler after unsubscribe", async () => {
      // After calling the cleanup function returned by on(),
      // the handler should not be called for subsequent events
    });
  });

  describe("error handling", () => {
    it("handles WebSocket errors gracefully", async () => {
      // WebSocket errors should be logged but not crash the app
    });

    it("handles malformed server messages", async () => {
      // Invalid JSON or unexpected message format should be handled gracefully
    });

    it("handles fetch port failure", async () => {
      // If /api/ws-port fails, should retry connection after delay
    });
  });

  describe("state", () => {
    it("exposes connected boolean", () => {
      // connected should accurately reflect WebSocket connection state
    });

    it("exposes clientId when connected", () => {
      // clientId should be null initially, then set after server sends it
    });

    it("resets state on disconnect", () => {
      // On disconnect, connected=false, clientId=null
    });
  });

  // Gateway regression (supersedes the plan-005 host:port derivation): the
  // event socket must connect same-origin — the exact host:port the renderer
  // was loaded from — plus NEXT_PUBLIC_BASE_PATH, with no separate ws port.
  // That is what lets /events ride the single Tailscale Serve route
  // (/hilt -> :3000) from laptop and phone, not just localhost.
  describe("websocket url derivation", () => {
    function captureUrls(): string[] {
      const urls: string[] = [];
      class CaptureWS extends MockWebSocket {
        constructor(url: string) {
          super(url);
          urls.push(url);
        }
      }
      // @ts-expect-error - Mocking global WebSocket
      global.WebSocket = CaptureWS;
      return urls;
    }

    function withLocation(
      loc: { protocol: string; host: string },
      run: () => Promise<void>,
    ): Promise<void> {
      const orig = Object.getOwnPropertyDescriptor(window, "location");
      Object.defineProperty(window, "location", { configurable: true, value: loc });
      return run().finally(() => {
        if (orig) Object.defineProperty(window, "location", orig);
        vi.unstubAllEnvs();
      });
    }

    it("connects same-origin (host incl. port), never a separate ws port", async () => {
      vi.useRealTimers();
      const urls = captureUrls();
      await withLocation(
        { protocol: "http:", host: "mac-mini.tailnet.ts.net:3000" },
        async () => {
          renderHook(() => useEventSocket());
          await waitFor(() => expect(urls.length).toBeGreaterThan(0));
          expect(urls[0]).toBe("ws://mac-mini.tailnet.ts.net:3000/events");
          expect(urls.every((u) => !u.includes("localhost"))).toBe(true);
        },
      );
    });

    it("uses wss when the page is served over https", async () => {
      vi.useRealTimers();
      const urls = captureUrls();
      await withLocation(
        { protocol: "https:", host: "hilt.example.ts.net" },
        async () => {
          renderHook(() => useEventSocket());
          await waitFor(() => expect(urls.length).toBeGreaterThan(0));
          expect(urls[0]).toBe("wss://hilt.example.ts.net/events");
        },
      );
    });

    it("prefixes the path with NEXT_PUBLIC_BASE_PATH in gateway mode", async () => {
      vi.useRealTimers();
      vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/hilt");
      const urls = captureUrls();
      await withLocation(
        { protocol: "https:", host: "xochipilli.tailc0acaa.ts.net" },
        async () => {
          renderHook(() => useEventSocket());
          await waitFor(() => expect(urls.length).toBeGreaterThan(0));
          expect(urls[0]).toBe("wss://xochipilli.tailc0acaa.ts.net/hilt/events");
        },
      );
    });
  });
});
