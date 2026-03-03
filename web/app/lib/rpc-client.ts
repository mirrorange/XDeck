/**
 * JSON-RPC 2.0 client over WebSocket.
 * Handles request/response mapping, timeouts, session auth, and event subscriptions.
 */

import { WsClient, type ConnectionState } from "./ws-client";

// -- Types --------------------------------------------------------

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

// -- RPC Client ---------------------------------------------------

export class RpcClient {
  private ws: WsClient;
  private pending = new Map<string, PendingRequest>();
  private nextId = 1;
  private eventHandlers = new Map<string, Set<EventHandler>>();
  private connectionHandlers = new Set<ConnectionHandler>();
  private pendingConnection: Promise<void> | null = null;
  private timeout: number;
  private _state: ConnectionState = "disconnected";

  // Auth token for reconnect-time session authentication.
  private authToken: string | null = null;
  // Whether current WS session is authenticated via auth.authenticate.
  private sessionAuthenticated = false;
  private pendingSessionAuth: Promise<void> | null = null;

  // Desired event topics based on local listeners: topic -> ref count.
  private topicRefCounts = new Map<string, number>();
  // Topics confirmed as subscribed on current WS session.
  private serverSubscribedTopics = new Set<string>();
  // Per-topic sync queue to avoid racing subscribe/unsubscribe calls.
  private topicSyncQueue = new Map<string, Promise<void>>();

  constructor(url: string, timeout = 10000) {
    this.timeout = timeout;
    this.ws = new WsClient({
      url,
      onMessage: (data) => this.handleMessage(data),
      onStateChange: (state) => {
        this._state = state;

        if (state === "disconnected") {
          this.serverSubscribedTopics.clear();
          this.sessionAuthenticated = false;
          this.pendingSessionAuth = null;
        }

        if (state === "connected") {
          this.sessionAuthenticated = false;
          void this.restoreSessionAfterConnect();
        }

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
    // Reject all pending requests.
    for (const [, req] of this.pending) {
      clearTimeout(req.timer);
      req.reject(new Error("Connection closed"));
    }
    this.pending.clear();
    this.serverSubscribedTopics.clear();
    this.sessionAuthenticated = false;
    this.pendingSessionAuth = null;
    this.ws.disconnect();
  }

  setAuthToken(token: string | null) {
    this.authToken = token;
    this.pendingSessionAuth = null;

    if (!token) {
      // Best-effort clear subscriptions on server for current authenticated session.
      const subscribedTopics = Array.from(this.serverSubscribedTopics);
      if (
        this.state === "connected" &&
        this.sessionAuthenticated &&
        subscribedTopics.length > 0
      ) {
        void this.sendRequest("event.unsubscribe", { topics: subscribedTopics }).catch((err) => {
          console.error("[RPC] Failed to clear subscriptions during logout:", err);
        });
      }

      this.serverSubscribedTopics.clear();
      this.sessionAuthenticated = false;
      return;
    }

    // New token should force re-auth on this WS session.
    this.sessionAuthenticated = false;

    if (this.state === "connected") {
      void this.restoreSessionAfterConnect();
    }
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

    if (this.requiresSessionAuth(method)) {
      await this.ensureSessionAuthenticated();
    }

    return this.sendRequest<T>(method, params);
  }

  /**
   * Subscribe to a server-pushed event topic.
   * Returns an unsubscribe function.
   */
  on(topic: string, handler: EventHandler): () => void {
    let handlers = this.eventHandlers.get(topic);
    if (!handlers) {
      handlers = new Set<EventHandler>();
      this.eventHandlers.set(topic, handlers);
    }

    const beforeSize = handlers.size;
    handlers.add(handler);
    if (beforeSize === 0 && handlers.size === 1) {
      this.updateTopicRef(topic, 1);
    }

    return () => {
      const topicHandlers = this.eventHandlers.get(topic);
      if (!topicHandlers) {
        return;
      }

      const prevSize = topicHandlers.size;
      topicHandlers.delete(handler);

      if (prevSize > 0 && topicHandlers.size === 0) {
        this.eventHandlers.delete(topic);
        this.updateTopicRef(topic, -1);
      }
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

    // Check if this is a response (has id).
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

    // It's a notification.
    const notification = msg as JsonRpcNotification;
    if (notification.method) {
      const handlers = this.eventHandlers.get(notification.method);
      if (handlers) {
        handlers.forEach((h) => h(notification.params));
      }
    }
  }

  private requiresSessionAuth(method: string): boolean {
    return (
      method.startsWith("process.") ||
      method === "event.subscribe" ||
      method === "event.unsubscribe"
    );
  }

  private async restoreSessionAfterConnect() {
    if (this.state !== "connected" || !this.authToken) {
      return;
    }

    try {
      await this.ensureSessionAuthenticated();
      await this.syncAllTopicSubscriptions();
    } catch (err) {
      console.error("[RPC] Failed to restore authenticated WS session:", err);
    }
  }

  private async ensureSessionAuthenticated(): Promise<void> {
    if (this.sessionAuthenticated) {
      return;
    }

    if (this.pendingSessionAuth) {
      return this.pendingSessionAuth;
    }

    const token = this.authToken;
    if (!token) {
      throw new Error("Missing auth token");
    }

    const task = this.sendRequest("auth.authenticate", { token })
      .then(() => {
        this.sessionAuthenticated = true;
      })
      .catch((err) => {
        this.sessionAuthenticated = false;
        throw err;
      });

    this.pendingSessionAuth = task;
    try {
      await task;
    } finally {
      if (this.pendingSessionAuth === task) {
        this.pendingSessionAuth = null;
      }
    }
  }

  private updateTopicRef(eventMethod: string, delta: 1 | -1) {
    const topic = this.eventMethodToTopic(eventMethod);
    if (!topic) {
      return;
    }

    const current = this.topicRefCounts.get(topic) ?? 0;
    const next = Math.max(current + delta, 0);

    if (next === 0) {
      this.topicRefCounts.delete(topic);
    } else {
      this.topicRefCounts.set(topic, next);
    }

    this.enqueueTopicSync(topic);
  }

  private eventMethodToTopic(eventMethod: string): string | null {
    if (!eventMethod.startsWith("event.")) {
      return null;
    }

    const topic = eventMethod.slice("event.".length).trim();
    if (!topic) {
      return null;
    }

    return topic;
  }

  private enqueueTopicSync(topic: string) {
    const previous = this.topicSyncQueue.get(topic) ?? Promise.resolve();
    const task = previous
      .then(() => this.syncTopicSubscription(topic))
      .catch((err) => {
        console.error(`[RPC] Failed to sync topic ${topic}:`, err);
      });

    this.topicSyncQueue.set(topic, task);
    void task.finally(() => {
      if (this.topicSyncQueue.get(topic) === task) {
        this.topicSyncQueue.delete(topic);
      }
    });
  }

  private async syncTopicSubscription(topic: string) {
    const desiredCount = this.topicRefCounts.get(topic) ?? 0;
    const shouldSubscribe = desiredCount > 0;

    if (this.state !== "connected") {
      return;
    }

    if (!this.authToken) {
      return;
    }

    const alreadySubscribed = this.serverSubscribedTopics.has(topic);
    if (shouldSubscribe === alreadySubscribed) {
      return;
    }

    await this.ensureSessionAuthenticated();

    if (shouldSubscribe) {
      await this.sendRequest("event.subscribe", {
        topics: [topic],
      });
      this.serverSubscribedTopics.add(topic);
      return;
    }

    await this.sendRequest("event.unsubscribe", {
      topics: [topic],
    });
    this.serverSubscribedTopics.delete(topic);
  }

  private async syncAllTopicSubscriptions() {
    if (this.state !== "connected") {
      return;
    }

    if (!this.authToken) {
      return;
    }

    await this.ensureSessionAuthenticated();

    // New WS session: rebuild server subscriptions from desired refs.
    this.serverSubscribedTopics.clear();

    const topics = Array.from(this.topicRefCounts.entries())
      .filter(([, count]) => count > 0)
      .map(([topic]) => topic);

    for (const topic of topics) {
      this.enqueueTopicSync(topic);
    }
  }

  private sendRequest<T = unknown>(
    method: string,
    params?: Record<string, unknown>
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = String(this.nextId++);

      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RPC call "${method}" timed out after ${this.timeout}ms`));
      }, this.timeout);

      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
      });

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

// -- Singleton ----------------------------------------------------

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
