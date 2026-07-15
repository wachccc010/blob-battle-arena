export const WORLD_WIDTH = 5600;
export const WORLD_HEIGHT = 5600;
export const TREE_COUNT = 90;
export const TREE_HP = 5;
export const TREE_RADIUS = 30;
export const TREE_RESPAWN_MS = 8000;
export const PLAYER_BASE_RADIUS = 20;
export const PLAYER_MAX_HP = 5;
export const PLAYER_SPEED = 230; // px/sec
export const CHOP_RANGE = 62;   // player-to-tree reach
export const ATTACK_RANGE = 75; // player-to-player reach
export const CHOP_COOLDOWN_MS = 450;
export const TICK_MS = 50;
export const HP_REGEN_INTERVAL_MS = 4000; // +1 HP every 4 s when out of combat

/** Sword tier definitions. Index = swordLevel (0 = no sword). */
export const SWORD_TIERS = [
  { level: 0, name: "None",         damage: 0, cost: 0   },
  { level: 1, name: "Wooden Sword", damage: 1, cost: 1   }, // buy
  { level: 2, name: "Iron Sword",   damage: 2, cost: 10  }, // upgrade
  { level: 3, name: "Steel Sword",  damage: 3, cost: 50  }, // upgrade
  { level: 4, name: "Golden Sword", damage: 5, cost: 100 }, // upgrade
] as const;

export function swordDamage(swordLevel: number): number {
  return SWORD_TIERS[swordLevel]?.damage ?? 0;
}

export function randomWorldPos(): { x: number; y: number } {
  return {
    x: 60 + Math.random() * (WORLD_WIDTH - 120),
    y: 60 + Math.random() * (WORLD_HEIGHT - 120),
  };
}

export function playerRadiusForCoins(coins: number): number {
  return Math.min(PLAYER_BASE_RADIUS + Math.sqrt(coins) * 3, 46);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function distance(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  return Math.hypot(ax - bx, ay - by);
}
