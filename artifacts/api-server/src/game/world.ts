export const WORLD_WIDTH = 3600;
export const WORLD_HEIGHT = 3600;
export const TREE_COUNT = 70;
export const TREE_HP = 3;
export const TREE_RADIUS = 30;
export const TREE_RESPAWN_MS = 8000;
export const PLAYER_BASE_RADIUS = 20;
export const PLAYER_SPEED = 230; // px/sec
export const CHOP_RANGE = 62;
export const CHOP_COOLDOWN_MS = 450;
export const SWORD_COST = 1;
export const TICK_MS = 50;

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
