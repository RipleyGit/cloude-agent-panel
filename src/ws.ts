// Single WS connection with auto-reconnect. Frames are delivered to
// subscribers synchronously; each feature manages its own state.

import type { NormalizedMessage } from './types';

type Listener = (message: NormalizedMessage) => void;

class PanelSocket {
  private socket: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private reconnectTimer: number | null = null;
  private queue: string[] = [];

  connect(): void {
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) return;
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${protocol}://${window.location.host}/ws`);
    this.socket = socket;

    socket.onopen = () => {
      for (const payload of this.queue.splice(0)) socket.send(payload);
      for (const listener of this.listeners) {
        listener({ kind: 'sessions_changed' } as NormalizedMessage); // reconnect hint: refetch
      }
    };
    socket.onmessage = (event) => {
      let message: NormalizedMessage;
      try {
        message = JSON.parse(event.data as string) as NormalizedMessage;
      } catch {
        return;
      }
      for (const listener of this.listeners) listener(message);
    };
    socket.onclose = () => {
      this.socket = null;
      if (this.reconnectTimer === null) {
        this.reconnectTimer = window.setTimeout(() => {
          this.reconnectTimer = null;
          this.connect();
        }, 3000);
      }
    };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    this.connect();
    return () => this.listeners.delete(listener);
  }

  send(payload: unknown): void {
    const data = JSON.stringify(payload);
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(data);
    } else {
      this.queue.push(data);
      this.connect();
    }
  }
}

export const panelSocket = new PanelSocket();
