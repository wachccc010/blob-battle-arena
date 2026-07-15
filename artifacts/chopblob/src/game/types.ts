export interface PlayerState {
  id: string;
  name: string;
  x: number;
  y: number;
  angle: number;
  radius: number;
  coins: number;
  swordLevel: number; // 0 = no sword, 1–4 = tiers
  lastChopAt: number;
}

export interface TreeState {
  id: string;
  x: number;
  y: number;
  radius: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  respawnAt: number;
}

export interface ChopEvent {
  treeId: string;
  x: number;
  y: number;
  coinAwarded: boolean;
  chopperId: string;
}

export type ClientMessage =
  | { type: "join"; name: string }
  | { type: "input"; dx: number; dy: number }
  | { type: "buySword" }
  | { type: "upgradeSword" }
  | { type: "chop" };

export type ServerMessage =
  | { type: "welcome"; id: string; world: { width: number; height: number } }
  | {
      type: "state";
      players: PlayerState[];
      trees: TreeState[];
      chops: ChopEvent[];
      you: PlayerState;
    }
  | { type: "error"; message: string };
