import { WebSocketServer, WebSocket } from "ws";
import { EventEmitter } from "events";
import * as http from "http";
import * as crypto from "crypto";
import { Duplex } from "stream";

interface Subscription {
  clientId: string;
  channel: string;
  params: Record<string, unknown>;
}

interface ClientMessage {
  type: "subscribe" | "unsubscribe" | "ping";
  channel?: string;
  params?: Record<string, unknown>;
}

interface ServerMessage {
  type: "connected" | "subscribed" | "unsubscribed" | "pong" | "error";
  clientId?: string;
  channel?: string;
  message?: string;
}

interface EventMessage {
  channel: string;
  event: string;
  data: unknown;
}

/**
 * WebSocket server for real-time events.
 * Supports channel-based subscriptions with filtering.
 */
export class EventServer extends EventEmitter {
  private wss: WebSocketServer;
  private clients: Map<string, WebSocket> = new Map();
  private subscriptions: Map<string, Subscription[]> = new Map();

  constructor() {
    super();
    // Use noServer mode - we'll handle upgrades manually
    this.wss = new WebSocketServer({ noServer: true });
    this.wss.on("connection", this.handleConnection.bind(this));
  }

  /**
   * Handle an upgrade request from the HTTP server
   */
  handleUpgrade(request: http.IncomingMessage, socket: Duplex, head: Buffer) {
    this.wss.handleUpgrade(request, socket, head, (ws) => {
      this.wss.emit("connection", ws, request);
    });
  }

  private handleConnection(ws: WebSocket) {
    const clientId = crypto.randomUUID();
    this.clients.set(clientId, ws);
    this.subscriptions.set(clientId, []);

    console.log(`[EventServer] Client connected: ${clientId}`);

    ws.on("message", (data) => {
      try {
        const msg: ClientMessage = JSON.parse(data.toString());
        this.handleMessage(clientId, msg);
      } catch (err) {
        console.error(`[EventServer] Error parsing message from ${clientId}:`, err);
        this.sendToClient(clientId, { type: "error", message: "Invalid JSON" });
      }
    });

    ws.on("close", () => {
      console.log(`[EventServer] Client disconnected: ${clientId}`);
      this.clients.delete(clientId);
      this.subscriptions.delete(clientId);
      this.emit("client:disconnected", clientId);
    });

    ws.on("error", (err) => {
      console.error(`[EventServer] WebSocket error for ${clientId}:`, err);
    });

    // Send connected message with clientId
    this.sendToClient(clientId, { type: "connected", clientId });
    this.emit("client:connected", clientId);
  }

  private handleMessage(clientId: string, msg: ClientMessage) {
    switch (msg.type) {
      case "subscribe":
        if (msg.channel) {
          this.subscribe(clientId, msg.channel, msg.params || {});
        }
        break;

      case "unsubscribe":
        if (msg.channel) {
          this.unsubscribe(clientId, msg.channel);
        }
        break;

      case "ping":
        this.sendToClient(clientId, { type: "pong" });
        break;
    }
  }

  private sendToClient(clientId: string, msg: ServerMessage | EventMessage) {
    const ws = this.clients.get(clientId);
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  /**
   * Subscribe a client to a channel with optional filtering params
   */
  subscribe(clientId: string, channel: string, params: Record<string, unknown>) {
    const subs = this.subscriptions.get(clientId);
    if (!subs) return;

    // Check if already subscribed to this channel
    const existing = subs.find((s) => s.channel === channel);
    if (existing) {
      // Update params
      existing.params = params;
    } else {
      subs.push({ clientId, channel, params });
    }

    console.log(`[EventServer] Client ${clientId} subscribed to ${channel}`, params);
    this.sendToClient(clientId, { type: "subscribed", channel });
    this.emit("subscription:added", { clientId, channel, params });
  }

  /**
   * Unsubscribe a client from a channel
   */
  unsubscribe(clientId: string, channel: string) {
    const subs = this.subscriptions.get(clientId);
    if (!subs) return;

    const idx = subs.findIndex((s) => s.channel === channel);
    if (idx !== -1) {
      subs.splice(idx, 1);
      console.log(`[EventServer] Client ${clientId} unsubscribed from ${channel}`);
      this.sendToClient(clientId, { type: "unsubscribed", channel });
      this.emit("subscription:removed", { clientId, channel });
    }
  }

  /**
   * Broadcast an event to all subscribers of a channel
   * Optional filter function to narrow recipients based on subscription params
   */
  broadcast(
    channel: string,
    event: string,
    data: unknown,
    filter?: (params: Record<string, unknown>) => boolean
  ) {
    let sentCount = 0;

    for (const [clientId, subs] of this.subscriptions) {
      const sub = subs.find((s) => s.channel === channel);
      if (sub && (!filter || filter(sub.params))) {
        const ws = this.clients.get(clientId);
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ channel, event, data }));
          sentCount++;
        }
      }
    }

    if (sentCount > 0) {
      console.log(`[EventServer] Broadcast ${channel}:${event} to ${sentCount} clients`);
    }
  }

  /**
   * Broadcast an event to ALL connected clients regardless of subscriptions.
   * Used for global events like navigation commands.
   */
  broadcastAll(channel: string, event: string, data: unknown) {
    let sentCount = 0;

    for (const [, ws] of this.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ channel, event, data }));
        sentCount++;
      }
    }

    if (sentCount > 0) {
      console.log(`[EventServer] BroadcastAll ${channel}:${event} to ${sentCount} clients`);
    }
  }

  /**
   * Get all clients subscribed to a channel
   */
  getSubscribers(channel: string): Array<{ clientId: string; params: Record<string, unknown> }> {
    const result: Array<{ clientId: string; params: Record<string, unknown> }> = [];

    for (const [clientId, subs] of this.subscriptions) {
      const sub = subs.find((s) => s.channel === channel);
      if (sub) {
        result.push({ clientId, params: sub.params });
      }
    }

    return result;
  }

  /**
   * Get count of connected clients
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Close the server
   */
  close() {
    this.wss.close();
    this.clients.clear();
    this.subscriptions.clear();
  }
}
