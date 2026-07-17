import type { ClientMessage, ServerMessage } from './types';

export function buildWsUrl(): string {
  return 'wss://chobblob-server.onrender.com/api/ws';
  }

export type MessageHandler = (message: ServerMessage) => void;

export class GameSocket {
  private socket: WebSocket | null = null;
  private handlers = new Set<MessageHandler>();
  private openHandlers = new Set<() => void>();
  private closeHandlers = new Set<() => void>();

  connect(): void {
    const socket = new WebSocket(buildWsUrl());
    this.socket = socket;

    socket.addEventListener('open', () => {
      for (const handler of this.openHandlers) handler();
    });

    socket.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(event.data) as ServerMessage;
        for (const handler of this.handlers) handler(message);
      } catch {
        // ignore malformed messages
      }
    });

    socket.addEventListener('close', () => {
      for (const handler of this.closeHandlers) handler();
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
