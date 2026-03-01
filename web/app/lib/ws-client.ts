/**
 * WebSocket connection manager with auto-reconnect and exponential backoff.
 */

export type ConnectionState = "disconnected" | "connecting" | "connected";

export interface WsClientOptions {
  url: string;
  onMessage?: (data: string) => void;
  onStateChange?: (state: ConnectionState) => void;
  maxReconnectDelay?: number;
  initialReconnectDelay?: number;
}

export class WsClient {
  private ws: WebSocket | null = null;
  private url: string;
  private onMessage?: (data: string) => void;
  private onStateChange?: (state: ConnectionState) => void;
  private reconnectDelay: number;
  private initialReconnectDelay: number;
  private maxReconnectDelay: number;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;
  private _state: ConnectionState = "disconnected";

  constructor(options: WsClientOptions) {
    this.url = options.url;
    this.onMessage = options.onMessage;
    this.onStateChange = options.onStateChange;
    this.initialReconnectDelay = options.initialReconnectDelay ?? 1000;
    this.maxReconnectDelay = options.maxReconnectDelay ?? 30000;
    this.reconnectDelay = this.initialReconnectDelay;
  }

  get state(): ConnectionState {
    return this._state;
  }

  private setState(state: ConnectionState) {
    this._state = state;
    this.onStateChange?.(state);
  }

  connect() {
    if (this.ws) return;

    this.intentionalClose = false;
    this.setState("connecting");

    try {
      this.ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.setState("connected");
      this.reconnectDelay = this.initialReconnectDelay;
    };

    this.ws.onmessage = (event) => {
      this.onMessage?.(event.data as string);
    };

    this.ws.onclose = () => {
      this.ws = null;
      this.setState("disconnected");
      if (!this.intentionalClose) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      // onclose will fire after onerror
    };
  }

  disconnect() {
    this.intentionalClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setState("disconnected");
  }

  send(data: string): boolean {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(data);
      return true;
    }
    return false;
  }

  private scheduleReconnect() {
    if (this.intentionalClose) return;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelay);

    // Exponential backoff
    this.reconnectDelay = Math.min(
      this.reconnectDelay * 2,
      this.maxReconnectDelay
    );
  }
}
