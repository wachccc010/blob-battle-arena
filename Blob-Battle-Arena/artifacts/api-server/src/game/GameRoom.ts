import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { logger } from "../lib/logger";
import type {
  ClientMessage,
  KillEvent,
  PlayerState,
  ServerMessage,
  TreeState,
  ChopEvent,
} from "./types";
import {
  ATTACK_RANGE,
  CHOP_COOLDOWN_MS,
  CHOP_RANGE,
  HP_REGEN_INTERVAL_MS,
  MAX_PLAYERS,
  PLAYER_MAX_HP,
  PLAYER_SPEED,
  SWORD_TIERS,
  TICK_MS,
  TREE_COUNT,
  TREE_HP,
  TREE_RADIUS,
  TREE_RESPAWN_MS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  clamp,
  distance,
  playerRadiusForCoins,
  randomWorldPos,
  swordDamage,
} from "./world";

interface Connection {
  id: string;
  socket: WebSocket;
  input: { dx: number; dy: number };
}

/**
 * One isolated game world / lobby room.
 * GameServer creates and routes sockets to these.
 */
export class GameRoom {
  private players    = new Map<string, PlayerState>();
  private connections = new Map<string, Connection>();
  private trees      = new Map<string, TreeState>();
  private pendingChops: ChopEvent[] = [];
  private pendingKills: KillEvent[] = [];
  private lastHitAt  = new Map<string, number>();

  private tickTimer:  ReturnType<typeof setInterval>;
  private emptyTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    public readonly code: string,
    private readonly onEmpty: () => void,
  ) {
    this.seedTrees();
    this.tickTimer = setInterval(() => this.tick(), TICK_MS);
    logger.info({ lobby: code }, "Game room created");
  }

  get playerCount(): number { return this.players.size; }

  // ── Public API ────────────────────────────────────────────────────────────

  handleConnection(socket: WebSocket): void {
    // Reject if room is already at capacity
    if (this.players.size >= MAX_PLAYERS) {
      this.send(socket, { type: "error", message: `Room is full (max ${MAX_PLAYERS} players)` });
      socket.close(1008, "Room full");
      return;
    }

    const id = randomUUID();

    socket.on("message", (raw) => {
      let msg: ClientMessage;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      this.handleMessage(id, socket, msg);
    });

    socket.on("close", () => this.removePlayer(id));
    socket.on("error", () => this.removePlayer(id));
  }

  destroy(): void {
    clearInterval(this.tickTimer);
    if (this.emptyTimer) clearTimeout(this.emptyTimer);
    for (const conn of this.connections.values()) {
      try { conn.socket.terminate(); } catch { /* ignore */ }
    }
    logger.info({ lobby: this.code }, "Game room destroyed");
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private removePlayer(id: string): void {
    this.players.delete(id);
    this.connections.delete(id);
    this.lastHitAt.delete(id);

    if (this.players.size === 0 && !this.emptyTimer) {
      this.emptyTimer = setTimeout(this.onEmpty, 60_000);
    }
  }

  private seedTrees(): void {
    for (let i = 0; i < TREE_COUNT; i++) {
      const pos = randomWorldPos();
      const tree: TreeState = {
        id: randomUUID(),
        x: pos.x, y: pos.y,
        radius: TREE_RADIUS,
        hp: TREE_HP, maxHp: TREE_HP,
        alive: true, respawnAt: 0,
      };
      this.trees.set(tree.id, tree);
    }
  }

  private spawnPlayer(id: string, name: string, swordLevel = 0): PlayerState {
    const pos = randomWorldPos();
    return {
      id, name,
      x: pos.x, y: pos.y,
      angle: 0,
      radius: playerRadiusForCoins(1),
      coins: 1,
      hp: PLAYER_MAX_HP, maxHp: PLAYER_MAX_HP,
      swordLevel,
      lastChopAt: 0,
    };
  }

  private handleMessage(id: string, socket: WebSocket, msg: ClientMessage): void {
    if (msg.type === "join") {
      // Double-check capacity at join time (race-condition safety)
      if (this.players.size >= MAX_PLAYERS) {
        this.send(socket, { type: "error", message: `Room is full (max ${MAX_PLAYERS} players)` });
        socket.close(1008, "Room full");
        return;
      }
      const name = (msg.name ?? "").toString().trim().slice(0, 16) || "Blob";
      const player = this.spawnPlayer(id, name);
      this.players.set(id, player);
      this.connections.set(id, { id, socket, input: { dx: 0, dy: 0 } });

      // Cancel any pending empty-room cleanup
      if (this.emptyTimer) { clearTimeout(this.emptyTimer); this.emptyTimer = null; }

      this.send(socket, {
        type: "welcome",
        id,
        world: { width: WORLD_WIDTH, height: WORLD_HEIGHT },
      });
      return;
    }

    const conn   = this.connections.get(id);
    const player = this.players.get(id);
    if (!conn || !player) return;

    if (msg.type === "input") {
      conn.input = {
        dx: clamp(Number(msg.dx) || 0, -1, 1),
        dy: clamp(Number(msg.dy) || 0, -1, 1),
      };
      return;
    }

    if (msg.type === "buySword") {
      if (player.swordLevel >= 1) return;
      const cost = SWORD_TIERS[1].cost;
      if (player.coins < cost) {
        this.send(socket, { type: "error", message: "Not enough coins" });
        return;
      }
      player.coins -= cost;
      player.swordLevel = 1;
      return;
    }

    if (msg.type === "upgradeSword") {
      const next = player.swordLevel + 1;
      if (next >= SWORD_TIERS.length) {
        this.send(socket, { type: "error", message: "Already max level" });
        return;
      }
      const cost = SWORD_TIERS[next].cost;
      if (player.coins < cost) {
        this.send(socket, { type: "error", message: "Not enough coins" });
        return;
      }
      player.coins -= cost;
      player.swordLevel = next;
      return;
    }

    if (msg.type === "chop") {
      this.tryAction(player);
      return;
    }
  }

  private tryAction(player: PlayerState): void {
    if (player.swordLevel === 0) return;
    const now = Date.now();
    if (now - player.lastChopAt < CHOP_COOLDOWN_MS) return;

    // 1. Attack nearest enemy player
    let targetPlayer: PlayerState | undefined;
    let bestDist = Infinity;
    for (const other of this.players.values()) {
      if (other.id === player.id) continue;
      const d = distance(player.x, player.y, other.x, other.y);
      if (d < player.radius + other.radius + ATTACK_RANGE && d < bestDist) {
        bestDist = d; targetPlayer = other;
      }
    }
    if (targetPlayer) {
      player.lastChopAt = now;
      const dmg = swordDamage(player.swordLevel);
      targetPlayer.hp -= dmg;
      this.lastHitAt.set(targetPlayer.id, now);

      if (targetPlayer.hp <= 0) {
        const gained = targetPlayer.coins - 1;
        player.coins += gained;
        player.radius = playerRadiusForCoins(player.coins);
        this.pendingKills.push({
          killerId: player.id, killerName: player.name,
          victimId: targetPlayer.id, victimName: targetPlayer.name,
          coinsGained: gained,
          x: targetPlayer.x, y: targetPlayer.y,
        });
        this.players.set(targetPlayer.id, this.spawnPlayer(targetPlayer.id, targetPlayer.name, targetPlayer.swordLevel));
        this.lastHitAt.delete(targetPlayer.id);
      }
      return;
    }

    // 2. Chop nearest tree
    let targetTree: TreeState | undefined;
    bestDist = Infinity;
    for (const tree of this.trees.values()) {
      if (!tree.alive) continue;
      const d = distance(player.x, player.y, tree.x, tree.y);
      if (d < player.radius + tree.radius + CHOP_RANGE && d < bestDist) {
        bestDist = d; targetTree = tree;
      }
    }
    if (!targetTree) return;

    player.lastChopAt = now;
    targetTree.hp -= swordDamage(player.swordLevel);

    if (targetTree.hp <= 0) {
      targetTree.alive = false;
      targetTree.respawnAt = now + TREE_RESPAWN_MS;
      player.coins += 1;
      player.radius = playerRadiusForCoins(player.coins);
      this.pendingChops.push({ treeId: targetTree.id, x: targetTree.x, y: targetTree.y, coinAwarded: true,  chopperId: player.id });
    } else {
      this.pendingChops.push({ treeId: targetTree.id, x: targetTree.x, y: targetTree.y, coinAwarded: false, chopperId: player.id });
    }
  }

  private tick(): void {
    const dt  = TICK_MS / 1000;
    const now = Date.now();

    for (const conn of this.connections.values()) {
      const player = this.players.get(conn.id);
      if (!player) continue;

      // Movement
      const { dx, dy } = conn.input;
      const len = Math.hypot(dx, dy);
      if (len > 0.001) {
        const nx = dx / len, ny = dy / len;
        player.x = clamp(player.x + nx * PLAYER_SPEED * dt, player.radius, WORLD_WIDTH  - player.radius);
        player.y = clamp(player.y + ny * PLAYER_SPEED * dt, player.radius, WORLD_HEIGHT - player.radius);
        player.angle = Math.atan2(ny, nx);
      }

      // HP regen
      if (player.hp < player.maxHp) {
        const lastHit = this.lastHitAt.get(conn.id) ?? 0;
        if (now - lastHit >= HP_REGEN_INTERVAL_MS) {
          player.hp = Math.min(player.hp + 1, player.maxHp);
          this.lastHitAt.set(conn.id, now - HP_REGEN_INTERVAL_MS + HP_REGEN_INTERVAL_MS / 2);
        }
      }
    }

    // Tree respawn
    for (const tree of this.trees.values()) {
      if (!tree.alive && now >= tree.respawnAt) {
        const pos = randomWorldPos();
        tree.x = pos.x; tree.y = pos.y;
        tree.hp = TREE_HP; tree.alive = true;
      }
    }

    const players = Array.from(this.players.values());
    const trees   = Array.from(this.trees.values());
    const chops   = this.pendingChops; this.pendingChops = [];
    const kills   = this.pendingKills; this.pendingKills = [];

    for (const conn of this.connections.values()) {
      const you = this.players.get(conn.id);
      if (!you) continue;
      this.send(conn.socket, { type: "state", players, trees, chops, kills, you });
    }
  }

  private send(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }
}
