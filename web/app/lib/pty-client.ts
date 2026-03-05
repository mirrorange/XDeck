/**
 * PTY WebSocket client.
 * Manages a WebSocket connection to a single PTY session for binary I/O + control messages.
 */

export type PtyClientState = "disconnected" | "connecting" | "connected";

export interface PtyClientOptions {
  sessionId: string;
  token: string;
  onData?: (data: Uint8Array) => void;
  onStateChange?: (state: PtyClientState) => void;
  onClose?: () => void;
}

export class PtyClient {
  private ws: WebSocket | null = null;
  private sessionId: string;
  private token: string;
  private onData?: (data: Uint8Array) => void;
  private onStateChange?: (state: PtyClientState) => void;
  private onClose?: () => void;
  private _state: PtyClientState = "disconnected";

  constructor(options: PtyClientOptions) {
    this.sessionId = options.sessionId;
    this.token = options.token;
    this.onData = options.onData;
    this.onStateChange = options.onStateChange;
    this.onClose = options.onClose;
  }

  get state(): PtyClientState {
    return this._state;
  }

  private setState(state: PtyClientState) {
    this._state = state;
    this.onStateChange?.(state);
  }

  connect() {
    if (this.ws) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const url = `${protocol}//${host}/ws/pty/${encodeURIComponent(this.sessionId)}?token=${encodeURIComponent(this.token)}`;

    this.setState("connecting");

    try {
      this.ws = new WebSocket(url);
      this.ws.binaryType = "arraybuffer";
    } catch {
      this.setState("disconnected");
      return;
    }

    this.ws.onopen = () => {
      this.setState("connected");
    };

    this.ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        this.onData?.(new Uint8Array(event.data));
      }
    };

    this.ws.onclose = () => {
      this.ws = null;
      this.setState("disconnected");
      this.onClose?.();
    };

    this.ws.onerror = () => {
      // onclose will fire after onerror
    };
  }

  disconnect() {
    if (!this.ws) return;
    this.ws.close();
    this.ws = null;
    this.setState("disconnected");
  }

  /** Send user input as binary data. */
  sendInput(data: string | Uint8Array) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    if (typeof data === "string") {
      const encoder = new TextEncoder();
      this.ws.send(encoder.encode(data));
    } else {
      this.ws.send(data);
    }
  }

  /** Send resize control message as text frame. */
  sendResize(cols: number, rows: number) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: "resize", cols, rows }));
  }
}
