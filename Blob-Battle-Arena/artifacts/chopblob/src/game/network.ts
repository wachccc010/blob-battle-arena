import type { ClientMessage, ServerMessage } from './types';

export function buildWsUrl(lobbyCode?: string | null): string {
    const base = 'wss://chobblob-server.onrender.com/api/ws';
      return lobbyCode ? `${base}?lobby=${encodeURIComponent(lobbyCode)}` : base;
      }

export function buildApiUrl(path: string): string {
  const { protocol, host } = window.location;
  return `${protocol}//${host}/api${path}`;
}

export type MessageHandler = (message: ServerMessage) => void;

export class GameSocket {
  private socket: WebSocket | null = null;
  private handlers      = new Set<MessageHandler>();
  private openHandlers  = new Set<() => void>();
  private closeHandlers = new Set<() => void>();

  constructor(private readonly lobbyCode?: string | null) {}

  connect(): void {
    const socket = new WebSocket(buildWsUrl(this.lobbyCode));
    this.socket = socket;

    socket.addEventListener('open', () => {
      for (const h of this.openHandlers) h();
    });

    socket.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(event.data) as ServerMessage;
        for (const h of this.handlers) h(message);
      } catch { /* ignore malformed */ }
    });

    socket.addEventListener('close', () => {
      for (const h of this.closeHandlers) h();
    });
  }

  onMessage(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  onOpen(handler: () => void): () => void {
    this.openHandlers.add(handler);
    return () => this.openHandlers.delete(handler);
  }

  onClose(handler: () => void): () => void {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }

  send(message: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }

  close(): void {
    this.socket?.close();
    this.socket = null;
  }
}
