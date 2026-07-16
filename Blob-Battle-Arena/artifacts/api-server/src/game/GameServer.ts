import type { Server as HttpServer } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
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

export class GameServer {
  private wss: WebSocketServer;
  private players = new Map<string, PlayerState>();
  private connections = new Map<string, Connection>();
  private trees = new Map<string, TreeState>();
  private pendingChops: ChopEvent[] = [];
  private pendingKills: KillEvent[] = [];
  /** Tracks time of last hit received per player id (for HP regen). */
  private lastHitAt = new Map<string, number>();

  constructor(server: HttpServer) {
    this.wss = new WebSocketServer({ server, path: "/api/ws" });
    this.seedTrees();
    this.wss.on("connection", (socket) => this.handleConnection(socket));
    setInterval(() => this.tick(), TICK_MS);
    logger.info({ path: "/api/ws" }, "Game WebSocket server ready");
  }

  private seedTrees(): void {
    for (let i = 0; i < TREE_COUNT; i++) {
      const pos = randomWorldPos();
      const tree: TreeState = {
        id: randomUUID(),
        x: pos.x,
        y: pos.y,
        radius: TREE_RADIUS,
        hp: TREE_HP,
        maxHp: TREE_HP,
        alive: true,
        respawnAt: 0,
      };
      this.trees.set(tree.id, tree);
    }
  }

  private handleConnection(socket: WebSocket): void {
    const id = randomUUID();

    socket.on("message", (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      this.handleMessage(id, socket, msg);
    });

    socket.on("close", () => {
      this.players.delete(id);
      this.connections.delete(id);
      this.lastHitAt.delete(id);
    });

    socket.on("error", () => {
      this.players.delete(id);
      this.connections.delete(id);
      this.lastHitAt.delete(id);
    });
  }

  private spawnPlayer(id: string, name: string, swordLevel = 0): PlayerState {
    const pos = randomWorldPos();
    return {
      id,
      name,
      x: pos.x,
      y: pos.y,
      angle: 0,
      radius: playerRadiusForCoins(1),
      coins: 1,
      hp: PLAYER_MAX_HP,
      maxHp: PLAYER_MAX_HP,
      swordLevel,
      lastChopAt: 0,
    };
  }

  private handleMessage(
    id: string,
    socket: WebSocket,
    msg: ClientMessage,
  ): void {
    if (msg.type === "join") {
      const name = (msg.name ?? "").toString().trim().slice(0, 16) || "Blob";
      const player = this.spawnPlayer(id, name);
      this.players.set(id, player);
      this.connections.set(id, { id, socket, input: { dx: 0, dy: 0 } });

      const welcome: ServerMessage = {
        type: "welcome",
        id,
        world: { width: WORLD_WIDTH, height: WORLD_HEIGHT },
      };
      this.send(socket, welcome);
      return;
    }

    const conn = this.connections.get(id);
    const player = this.players.get(id);
    if (!conn || !player) return;

    if (msg.type === "input") {
      const dx = clamp(Number(msg.dx) || 0, -1, 1);
      const dy = clamp(Number(msg.dy) || 0, -1, 1);
      conn.input = { dx, dy };
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
      const nextLevel = player.swordLevel + 1;
      if (nextLevel >= SWORD_TIERS.length) {
        this.send(socket, { type: "error", message: "Already max level" });
        return;
      }
      const cost = SWORD_TIERS[nextLevel].cost;
      if (player.coins < cost) {
        this.send(socket, { type: "error", message: "Not enough coins" });
        return;
      }
      player.coins -= cost;
      player.swordLevel = nextLevel;
      return;
    }

    if (msg.type === "chop") {
      this.tryAction(player);
      return;
    }
  }

  /**
   * Unified action handler: attack a nearby enemy player first;
   * if none in range, chop a nearby tree.
   */
  private tryAction(player: PlayerState): void {
    if (player.swordLevel === 0) return;
    const now = Date.now();
    if (now - player.lastChopAt < CHOP_COOLDOWN_MS) return;

    // 1. Look for the closest enemy player within attack range.
    let targetPlayer: PlayerState | undefined;
    let bestPlayerDist = Infinity;
    for (const other of this.players.values()) {
      if (other.id === player.id) continue;
      const d = distance(player.x, player.y, other.x, other.y);
      if (
        d < player.radius + other.radius + ATTACK_RANGE &&
        d < bestPlayerDist
      ) {
        bestPlayerDist = d;
        targetPlayer = other;
      }
    }

    if (targetPlayer) {
      player.lastChopAt = now;
      const dmg = swordDamage(player.swordLevel);
      targetPlayer.hp -= dmg;
      this.lastHitAt.set(targetPlayer.id, now);

      if (targetPlayer.hp <= 0) {
        const coinsGained = targetPlayer.coins - 1; // victim keeps 1 coin on respawn
        player.coins += coinsGained;
        player.radius = playerRadiusForCoins(player.coins);

        this.pendingKills.push({
          killerId: player.id,
          killerName: player.name,
          victimId: targetPlayer.id,
          victimName: targetPlayer.name,
          coinsGained,
          x: targetPlayer.x,
          y: targetPlayer.y,
        });

        // Respawn victim: keep sword level, reset coins + hp + position.
        const respawned = this.spawnPlayer(
          targetPlayer.id,
          targetPlayer.name,
          targetPlayer.swordLevel,
        );
        this.players.set(targetPlayer.id, respawned);
        this.lastHitAt.delete(targetPlayer.id);
      }
      return;
    }

    // 2. No enemy in range — try to chop a tree instead.
    let targetTree: TreeState | undefined;
    let bestTreeDist = Infinity;
    for (const tree of this.trees.values()) {
      if (!tree.alive) continue;
      const d = distance(player.x, player.y, tree.x, tree.y);
      if (d < player.radius + tree.radius + CHOP_RANGE && d < bestTreeDist) {
        bestTreeDist = d;
        targetTree = tree;
      }
    }
    if (!targetTree) return;

    player.lastChopAt = now;
    const dmg = swordDamage(player.swordLevel);
    targetTree.hp -= dmg;

    if (targetTree.hp <= 0) {
      targetTree.alive = false;
      targetTree.respawnAt = now + TREE_RESPAWN_MS;
      player.coins += 1;
      player.radius = playerRadiusForCoins(player.coins);
      this.pendingChops.push({
        treeId: targetTree.id,
        x: targetTree.x,
        y: targetTree.y,
        coinAwarded: true,
        chopperId: player.id,
      });
    } else {
      this.pendingChops.push({
        treeId: targetTree.id,
        x: targetTree.x,
        y: targetTree.y,
        coinAwarded: false,
        chopperId: player.id,
      });
    }
  }

  private tick(): void {
    const dt = TICK_MS / 1000;
    const now = Date.now();

    for (const conn of this.connections.values()) {
      const player = this.players.get(conn.id);
      if (!player) continue;

      // Movement
      const { dx, dy } = conn.input;
      const len = Math.hypot(dx, dy);
      if (len > 0.001) {
        const nx = dx / len;
        const ny = dy / len;
        player.x = clamp(
          player.x + nx * PLAYER_SPEED * dt,
          player.radius,
          WORLD_WIDTH - player.radius,
        );
        player.y = clamp(
          player.y + ny * PLAYER_SPEED * dt,
          player.radius,
          WORLD_HEIGHT - player.radius,
        );
        player.angle = Math.atan2(ny, nx);
      }

      // HP regen: +1 HP if out of combat for HP_REGEN_INTERVAL_MS
      if (player.hp < player.maxHp) {
        const lastHit = this.lastHitAt.get(conn.id) ?? 0;
        if (now - lastHit >= HP_REGEN_INTERVAL_MS) {
          player.hp = Math.min(player.hp + 1, player.maxHp);
          // Reset the timer so next regen tick waits another interval
          this.lastHitAt.set(conn.id, now - HP_REGEN_INTERVAL_MS + HP_REGEN_INTERVAL_MS / 2);
        }
      }
    }

    for (const tree of this.trees.values()) {
      if (!tree.alive && now >= tree.respawnAt) {
        const pos = randomWorldPos();
        tree.x = pos.x;
        tree.y = pos.y;
        tree.hp = TREE_HP;
        tree.alive = true;
      }
    }

    const playersArr = Array.from(this.players.values());
    const treesArr = Array.from(this.trees.values());
    const chops = this.pendingChops;
    const kills = this.pendingKills;
    this.pendingChops = [];
    this.pendingKills = [];

    for (const conn of this.connections.values()) {
      const you = this.players.get(conn.id);
      if (!you) continue;
      const message: ServerMessage = {
        type: "state",
        players: playersArr,
        trees: treesArr,
        chops,
        kills,
        you,
      };
      this.send(conn.socket, message);
    }
  }

  private send(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }
}
