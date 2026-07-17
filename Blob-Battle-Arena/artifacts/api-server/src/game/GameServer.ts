import type { Server as HttpServer } from "node:http";
import { WebSocketServer } from "ws";
import { logger } from "../lib/logger";
import { GameRoom } from "./GameRoom";

/**
 * Thin router: creates/reuses a GameRoom per lobby code and hands each
 * incoming WebSocket to the right room.
 *
 * URL format:  /api/ws           → public room (code "PUBLIC")
 *              /api/ws?lobby=XYZ → private room code "XYZ"
 */
export class GameServer {
  private wss   = new WebSocketServer({ noServer: true });
  private rooms = new Map<string, GameRoom>();

  constructor(server: HttpServer) {
    // Attach WS upgrade handler to the HTTP server so we can read the
    // full request URL (including query-string) before upgrading.
    server.on("upgrade", (req, socket, head) => {
      const url = req.url ?? "";
      if (!url.startsWith("/api/ws")) {
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.wss.emit("connection", ws, req);
      });
    });

    this.wss.on("connection", (socket, req) => {
      const qs     = (req.url ?? "").split("?")[1] ?? "";
      const params = new URLSearchParams(qs);
      const code   = sanitizeCode(params.get("lobby") ?? "PUBLIC");
      this.getOrCreateRoom(code).handleConnection(socket);
    });

    logger.info({ path: "/api/ws" }, "Game WebSocket server ready");
  }

  private getOrCreateRoom(code: string): GameRoom {
    let room = this.rooms.get(code);
    if (!room) {
      room = new GameRoom(code, () => {
        // onEmpty callback — schedule deletion after 60 s grace period
        setTimeout(() => {
          const r = this.rooms.get(code);
          if (r && r.playerCount === 0) {
            r.destroy();
            this.rooms.delete(code);
            logger.info({ lobby: code }, "Game room removed (empty)");
          }
        }, 60_000);
      });
      this.rooms.set(code, room);
    }
    return room;
  }

  get roomCount(): number { return this.rooms.size; }
}

/** Strip anything that isn't alphanumeric; uppercase; cap at 10 chars. */
function sanitizeCode(raw: string): string {
  const clean = raw.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 10);
  return clean || "PUBLIC";
}
