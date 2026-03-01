/**
 * JSON-RPC 2.0 client over WebSocket.
 * Handles request/response mapping, timeouts, and event subscriptions.
 */

import { WsClient, type ConnectionState } from "./ws-client";

// ── Types ────────────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export type EventHandler = (params: unknown) => void;
type ConnectionHandler = (state: ConnectionState) => void;

// ── RPC Client ───────────────────────────────────────────────────

export class RpcClient {
  private ws: WsClient;
  private pending = new Map<string, PendingRequest>();
  private nextId = 1;
  private eventHandlers = new Map<string, Set<EventHandler>>();
  private connectionHandlers = new Set<ConnectionHandler>();
  private pendingConnection: Promise<void> | null = null;
  private timeout: number;
  private _state: ConnectionState = "disconnected";

  constructor(url: string, timeout = 10000) {
    this.timeout = timeout;
    this.ws = new WsClient({
      url,
      onMessage: (data) => this.handleMessage(data),
      onStateChange: (state) => {
        this._state = state;
        this.connectionHandlers.forEach((h) => h(state));
      },
    });
  }

  get state(): ConnectionState {
    return this._state;
  }

  connect() {
    this.ws.connect();
  }

  disconnect() {
    // Reject all pending requests
    for (const [, req] of this.pending) {
      clearTimeout(req.timer);
      req.reject(new Error("Connection closed"));
    }
    this.pending.clear();
    this.ws.disconnect();
  }

  onConnectionChange(handler: ConnectionHandler): () => void {
    this.connectionHandlers.add(handler);
    return () => this.connectionHandlers.delete(handler);
  }

  /**
   * Call a JSON-RPC method and wait for response.
   */
  async call<T = unknown>(
    method: string,
    params?: Record<string, unknown>
  ): Promise<T> {
    await this.ensureConnected(method);

    return new Promise((resolve, reject) => {
      const id = String(this.nextId++);

      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RPC call "${method}" timed out after ${this.timeout}ms`));
      }, this.timeout);

      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });

      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id,
        method,
        ...(params !== undefined && { params }),
      };

      const sent = this.ws.send(JSON.stringify(request));
      if (!sent) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(new Error(`RPC call "${method}" failed: WebSocket disconnected`));
      }
    });
  }

  /**
   * Subscribe to a server-pushed event topic.
   * Returns an unsubscribe function.
   */
  on(topic: string, handler: EventHandler): () => void {
    if (!this.eventHandlers.has(topic)) {
      this.eventHandlers.set(topic, new Set());
    }
    this.eventHandlers.get(topic)!.add(handler);
    return () => {
      this.eventHandlers.get(topic)?.delete(handler);
    };
  }

  private handleMessage(data: string) {
    let msg: JsonRpcResponse | JsonRpcNotification;
    try {
      msg = JSON.parse(data);
    } catch {
      console.error("[RPC] Failed to parse message:", data);
      return;
    }

    // Check if this is a response (has id)
    if ("id" in msg && msg.id !== null && msg.id !== undefined) {
      const response = msg as JsonRpcResponse;
      const pending = this.pending.get(String(response.id));
      if (pending) {
        this.pending.delete(String(response.id));
        clearTimeout(pending.timer);
        if (response.error) {
          pending.reject(
            new RpcError(response.error.message, response.error.code)
          );
        } else {
          pending.resolve(response.result);
        }
      }
      return;
    }

    // It's a notification
    const notification = msg as JsonRpcNotification;
    if (notification.method) {
      const handlers = this.eventHandlers.get(notification.method);
      if (handlers) {
        handlers.forEach((h) => h(notification.params));
      }
    }
  }

  private ensureConnected(method: string): Promise<void> {
    if (this.state === "connected") {
      return Promise.resolve();
    }

    if (this.pendingConnection) {
      return this.pendingConnection;
    }

    if (this.state === "disconnected") {
      this.connect();
    }

    this.pendingConnection = new Promise((resolve, reject) => {
      let done = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const finish = (err?: Error) => {
        if (done) return;
        done = true;
        if (timer) {
          clearTimeout(timer);
        }
        unsubscribe();
        this.pendingConnection = null;
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      };

      const unsubscribe = this.onConnectionChange((state) => {
        if (state === "connected") {
          finish();
        }
      });

      timer = setTimeout(() => {
        finish(
          new Error(
            `RPC call "${method}" failed: WebSocket not connected after ${this.timeout}ms`
          )
        );
      }, this.timeout);

      // Handle race: connection may already be up before listener is attached.
      if (this.state === "connected") {
        finish();
      }
    });

    return this.pendingConnection;
  }
}

export class RpcError extends Error {
  code: number;
  constructor(message: string, code: number) {
    super(message);
    this.name = "RpcError";
    this.code = code;
  }
}

// ── Singleton ────────────────────────────────────────────────────

let _client: RpcClient | null = null;

export function getRpcClient(): RpcClient {
  if (!_client) {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const url = `${protocol}//${host}/ws`;
    _client = new RpcClient(url);
  }
  return _client;
}
