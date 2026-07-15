import { useCallback, useEffect, useRef, useState } from 'react';
import { GameSocket } from './network';
import type { KillEvent, PlayerState, ServerMessage, TreeState } from './types';

const SWORD_TIERS = [
  { level: 0, name: 'None',         damage: 0, cost: 0   },
  { level: 1, name: 'Wooden Sword', damage: 1, cost: 1   },
  { level: 2, name: 'Iron Sword',   damage: 2, cost: 10  },
  { level: 3, name: 'Steel Sword',  damage: 3, cost: 50  },
  { level: 4, name: 'Golden Sword', damage: 5, cost: 100 },
] as const;

const SWORD_COLORS = ['', '#c8a96e', '#c0cdd8', '#6fa8dc', '#ffd700'];
const ATTACK_RANGE_VISUAL = 75;
const CHOP_RANGE_VISUAL = 62;

interface FloatingText {
  id: number;
  x: number;
  y: number;
  text: string;
  color: string;
  size: number;
  bornAt: number;
}

interface KillToast {
  id: number;
  text: string;
  bornAt: number;
  isMe: boolean;
}

interface GameCanvasProps {
  name: string;
  onExit: () => void;
}

const WORLD_BG = '#1f4d2e';
let floatId = 0;

export default function GameCanvas({ name, onExit }: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const socketRef = useRef<GameSocket | null>(null);
  const meIdRef = useRef<string>('');
  const worldRef = useRef({ width: 5600, height: 5600 });
  const playersRef = useRef<PlayerState[]>([]);
  const treesRef = useRef<TreeState[]>([]);
  const youRef = useRef<PlayerState | null>(null);
  const floatingRef = useRef<FloatingText[]>([]);
  const mouseRef = useRef({ x: 0, y: 0 });
  const swordFlashRef = useRef(0);
  const keysRef = useRef({ up: false, down: false, left: false, right: false });
  const joystickRef = useRef({ active: false, dx: 0, dy: 0 });
  const joystickTouchId = useRef<number | null>(null);
  const joystickBaseRef = useRef<HTMLDivElement>(null);
  const joystickKnobRef = useRef<HTMLDivElement>(null);

  const [connected, setConnected] = useState(false);
  const [coins, setCoins] = useState(1);
  const [hp, setHp] = useState(5);
  const [maxHp, setMaxHp] = useState(5);
  const [swordLevel, setSwordLevel] = useState(0);
  const [leaderboard, setLeaderboard] = useState<PlayerState[]>([]);
  const [nearTree, setNearTree] = useState(false);
  const [nearEnemy, setNearEnemy] = useState(false);
  const [showUpgrades, setShowUpgrades] = useState(false);
  const [killToasts, setKillToasts] = useState<KillToast[]>([]);
  const [isTouchDevice] = useState(
    () =>
      typeof window !== 'undefined' &&
      (window.matchMedia?.('(pointer: coarse)').matches ||
        navigator.maxTouchPoints > 0),
  );

  const action = useCallback(() => {
    socketRef.current?.send({ type: 'chop' });
    swordFlashRef.current = Date.now();
  }, []);

  const buySword = useCallback(() => {
    socketRef.current?.send({ type: 'buySword' });
  }, []);

  const upgradeSword = useCallback(() => {
    socketRef.current?.send({ type: 'upgradeSword' });
  }, []);

  // Kill toast auto-cleanup
  useEffect(() => {
    const timer = setInterval(() => {
      setKillToasts((prev) =>
        prev.filter((t) => Date.now() - t.bornAt < 3500),
      );
    }, 500);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const socket = new GameSocket();
    socketRef.current = socket;

    socket.onOpen(() => {
      setConnected(true);
      socket.send({ type: 'join', name });
    });

    socket.onClose(() => setConnected(false));

    socket.onMessage((message: ServerMessage) => {
      if (message.type === 'welcome') {
        meIdRef.current = message.id;
        worldRef.current = message.world;
      } else if (message.type === 'state') {
        playersRef.current = message.players;
        treesRef.current = message.trees;
        youRef.current = message.you;
        setCoins(message.you.coins);
        setHp(message.you.hp);
        setMaxHp(message.you.maxHp);
        setSwordLevel(message.you.swordLevel);

        const top = [...message.players]
          .sort((a, b) => b.coins - a.coins)
          .slice(0, 5);
        setLeaderboard(top);

        // Proximity checks
        let closestTree = Infinity;
        for (const tree of message.trees) {
          if (!tree.alive) continue;
          const d = Math.hypot(tree.x - message.you.x, tree.y - message.you.y);
          if (d < message.you.radius + tree.radius + CHOP_RANGE_VISUAL) {
            closestTree = Math.min(closestTree, d);
          }
        }
        setNearTree(closestTree < Infinity);

        let closestEnemy = Infinity;
        for (const p of message.players) {
          if (p.id === meIdRef.current) continue;
          const d = Math.hypot(p.x - message.you.x, p.y - message.you.y);
          if (d < message.you.radius + p.radius + ATTACK_RANGE_VISUAL) {
            closestEnemy = Math.min(closestEnemy, d);
          }
        }
        setNearEnemy(closestEnemy < Infinity);

        // Chop floating text
        for (const chopEvent of message.chops) {
          floatingRef.current.push({
            id: floatId++,
            x: chopEvent.x,
            y: chopEvent.y - 40,
            text: chopEvent.coinAwarded ? '+1 🪙' : 'chop!',
            color: chopEvent.coinAwarded ? '#ffd54a' : '#ffffff',
            size: chopEvent.coinAwarded ? 15 : 13,
            bornAt: Date.now(),
          });
        }

        // Kill floating text + toasts
        for (const kill of (message.kills as KillEvent[])) {
          const iAmKiller = kill.killerId === meIdRef.current;
          const iAmVictim = kill.victimId === meIdRef.current;

          floatingRef.current.push({
            id: floatId++,
            x: kill.x,
            y: kill.y - 50,
            text: iAmKiller
              ? `+${kill.coinsGained} 🪙`
              : `💀 ${kill.victimName}`,
            color: iAmKiller ? '#ffd700' : '#ff6b6b',
            size: 18,
            bornAt: Date.now(),
          });

          const toastText = iAmKiller
            ? `⚔️ You slew ${kill.victimName} (+${kill.coinsGained} coins)`
            : iAmVictim
            ? `💀 Slain by ${kill.killerName}! Respawning...`
            : `⚔️ ${kill.killerName} slew ${kill.victimName}`;

          setKillToasts((prev) => [
            ...prev.slice(-4),
            { id: floatId++, text: toastText, bornAt: Date.now(), isMe: iAmKiller || iAmVictim },
          ]);
        }
      } else if (message.type === 'error') {
        // eslint-disable-next-line no-console
        console.warn(message.message);
      }
    });

    socket.connect();

    return () => {
      socket.close();
    };
  }, [name]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let lastInputSent = 0;

    function resize() {
      canvas!.width = window.innerWidth;
      canvas!.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    function handleMouseMove(e: MouseEvent) {
      mouseRef.current = { x: e.clientX, y: e.clientY };
    }
    window.addEventListener('mousemove', handleMouseMove);

    function handleKeyDown(e: KeyboardEvent) {
      if (e.code === 'Space') {
        e.preventDefault();
        action();
        return;
      }
      switch (e.code) {
        case 'KeyW': case 'ArrowUp':    keysRef.current.up = true;    break;
        case 'KeyS': case 'ArrowDown':  keysRef.current.down = true;  break;
        case 'KeyA': case 'ArrowLeft':  keysRef.current.left = true;  break;
        case 'KeyD': case 'ArrowRight': keysRef.current.right = true; break;
        default: return;
      }
      e.preventDefault();
    }
    window.addEventListener('keydown', handleKeyDown);

    function handleKeyUp(e: KeyboardEvent) {
      switch (e.code) {
        case 'KeyW': case 'ArrowUp':    keysRef.current.up = false;    break;
        case 'KeyS': case 'ArrowDown':  keysRef.current.down = false;  break;
        case 'KeyA': case 'ArrowLeft':  keysRef.current.left = false;  break;
        case 'KeyD': case 'ArrowRight': keysRef.current.right = false; break;
        default: return;
      }
      e.preventDefault();
    }
    window.addEventListener('keyup', handleKeyUp);

    function handleClick() { action(); }
    canvas!.addEventListener('mousedown', handleClick);

    // ── Joystick ────────────────────────────────────────────────────────────
    function updateJoystickFromTouch(clientX: number, clientY: number) {
      const base = joystickBaseRef.current;
      const knob = joystickKnobRef.current;
      if (!base || !knob) return;
      const rect = base.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = clientX - cx;
      const dy = clientY - cy;
      const maxR = rect.width / 2;
      const len = Math.hypot(dx, dy);
      const clamped = Math.min(len, maxR);
      const nx = len > 0 ? dx / len : 0;
      const ny = len > 0 ? dy / len : 0;
      knob.style.transform = `translate(${nx * clamped}px, ${ny * clamped}px)`;
      const deadZone = 8;
      joystickRef.current.dx = len > deadZone ? nx : 0;
      joystickRef.current.dy = len > deadZone ? ny : 0;
    }

    function resetJoystick() {
      joystickRef.current = { active: false, dx: 0, dy: 0 };
      joystickTouchId.current = null;
      const knob = joystickKnobRef.current;
      if (knob) knob.style.transform = 'translate(0px, 0px)';
    }

    function handleTouchStart(e: TouchEvent) {
      const base = joystickBaseRef.current;
      if (!base) return;
      const touch = e.changedTouches[0];
      if (!touch) return;
      const rect = base.getBoundingClientRect();
      const withinZone =
        touch.clientX >= rect.left - 40 && touch.clientX <= rect.right + 40 &&
        touch.clientY >= rect.top - 40  && touch.clientY <= rect.bottom + 40;
      if (!withinZone || joystickTouchId.current !== null) return;
      joystickTouchId.current = touch.identifier;
      joystickRef.current.active = true;
      updateJoystickFromTouch(touch.clientX, touch.clientY);
    }

    function handleTouchMove(e: TouchEvent) {
      if (joystickTouchId.current === null) return;
      for (const touch of Array.from(e.changedTouches)) {
        if (touch.identifier === joystickTouchId.current) {
          e.preventDefault();
          updateJoystickFromTouch(touch.clientX, touch.clientY);
        }
      }
    }

    function handleTouchEnd(e: TouchEvent) {
      if (joystickTouchId.current === null) return;
      for (const touch of Array.from(e.changedTouches)) {
        if (touch.identifier === joystickTouchId.current) resetJoystick();
      }
    }

    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd);
    window.addEventListener('touchcancel', handleTouchEnd);

    function handleChopTap(e: TouchEvent) {
      const base = joystickBaseRef.current;
      const touch = e.changedTouches[0];
      if (!base || !touch) return;
      const rect = base.getBoundingClientRect();
      const withinZone =
        touch.clientX >= rect.left - 40 && touch.clientX <= rect.right + 40 &&
        touch.clientY >= rect.top - 40  && touch.clientY <= rect.bottom + 40;
      if (withinZone) return;
      action();
    }
    canvas!.addEventListener('touchstart', handleChopTap, { passive: true });

    // ── Drawing helpers ─────────────────────────────────────────────────────
    function drawTree(tree: TreeState) {
      ctx!.save();
      ctx!.fillStyle = '#3a2b1c';
      ctx!.fillRect(tree.x - 6, tree.y - 4, 12, 30);
      const hpRatio = tree.hp / tree.maxHp;
      const canopyColor =
        hpRatio > 0.66 ? '#2f8f3f' : hpRatio > 0.33 ? '#3fae4c' : '#7ec96a';
      ctx!.beginPath();
      ctx!.fillStyle = canopyColor;
      ctx!.arc(tree.x, tree.y - 14, tree.radius, 0, Math.PI * 2);
      ctx!.fill();
      ctx!.beginPath();
      ctx!.fillStyle = '#276b34';
      ctx!.arc(tree.x - 10, tree.y - 20, tree.radius * 0.55, 0, Math.PI * 2);
      ctx!.fill();
      ctx!.restore();
    }

    function hashHue(id: string): number {
      let hash = 0;
      for (let i = 0; i < id.length; i++)
        hash = (hash * 31 + id.charCodeAt(i)) % 360;
      return hash;
    }

    function drawPlayer(player: PlayerState, isYou: boolean) {
      const { x, y, radius, angle, swordLevel: sl, hp: phHp, maxHp: phMaxHp } = player;

      // Drop shadow
      ctx!.save();
      ctx!.beginPath();
      ctx!.fillStyle = 'rgba(0,0,0,0.2)';
      ctx!.ellipse(x, y + radius * 0.7, radius * 0.9, radius * 0.35, 0, 0, Math.PI * 2);
      ctx!.fill();
      ctx!.restore();

      // Body
      const hue = isYou ? 200 : hashHue(player.id);
      const grad = ctx!.createRadialGradient(
        x - radius * 0.3, y - radius * 0.3, radius * 0.2,
        x, y, radius,
      );
      grad.addColorStop(0, `hsl(${hue}, 85%, 70%)`);
      grad.addColorStop(1, `hsl(${hue}, 75%, 48%)`);

      ctx!.save();
      ctx!.beginPath();
      ctx!.fillStyle = grad;
      ctx!.strokeStyle = isYou ? '#ffffff' : 'rgba(0,0,0,0.25)';
      ctx!.lineWidth = isYou ? 3 : 2;
      ctx!.arc(x, y, radius, 0, Math.PI * 2);
      ctx!.fill();
      ctx!.stroke();
      ctx!.restore();

      // Eyes
      const ex = Math.cos(angle) * radius * 0.35;
      const ey = Math.sin(angle) * radius * 0.35;
      for (const side of [-1, 1]) {
        ctx!.save();
        ctx!.beginPath();
        ctx!.fillStyle = '#ffffff';
        ctx!.ellipse(
          x + ex + side * radius * 0.32, y + ey - radius * 0.15,
          radius * 0.22, radius * 0.26, 0, 0, Math.PI * 2,
        );
        ctx!.fill();
        ctx!.beginPath();
        ctx!.fillStyle = '#1c1c1c';
        ctx!.arc(
          x + ex + side * radius * 0.32 + Math.cos(angle) * 2,
          y + ey - radius * 0.15 + Math.sin(angle) * 2,
          radius * 0.11, 0, Math.PI * 2,
        );
        ctx!.fill();
        ctx!.restore();
      }

      // Sword
      if (sl > 0) {
        ctx!.save();
        ctx!.translate(x, y);
        ctx!.rotate(angle + Math.PI / 4);
        const flashActive = isYou && Date.now() - swordFlashRef.current < 150;
        ctx!.translate(radius * (flashActive ? 1.2 : 0.85), 0);
        const bladeH = radius * (0.9 + sl * 0.15);
        ctx!.fillStyle = SWORD_COLORS[sl] ?? '#d8dee6';
        ctx!.fillRect(-3, -bladeH, 6, bladeH);
        ctx!.fillStyle = sl === 4 ? '#d4a017' : '#8a5a2b';
        ctx!.fillRect(-6, radius * 0.05, 12, 7);
        ctx!.restore();
      }

      // Name label
      ctx!.save();
      ctx!.fillStyle = '#ffffff';
      ctx!.font = 'bold 13px sans-serif';
      ctx!.textAlign = 'center';
      ctx!.shadowColor = 'rgba(0,0,0,0.6)';
      ctx!.shadowBlur = 3;
      ctx!.fillText(player.name, x, y - radius - 18);
      ctx!.restore();

      // HP bar (drawn below name, above blob)
      const barW = radius * 2.2;
      const barH = 5;
      const barX = x - barW / 2;
      const barY = y - radius - 12;
      const hpRatio = Math.max(0, phHp / phMaxHp);
      const barColor = hpRatio > 0.6 ? '#4ade80' : hpRatio > 0.3 ? '#facc15' : '#ef4444';

      ctx!.save();
      ctx!.fillStyle = 'rgba(0,0,0,0.45)';
      ctx!.beginPath();
      ctx!.roundRect(barX - 1, barY - 1, barW + 2, barH + 2, 3);
      ctx!.fill();

      ctx!.fillStyle = barColor;
      ctx!.beginPath();
      ctx!.roundRect(barX, barY, barW * hpRatio, barH, 2);
      ctx!.fill();
      ctx!.restore();
    }

    // ── Main render ─────────────────────────────────────────────────────────
    function render() {
      const you = youRef.current;
      const W = canvas!.width;
      const H = canvas!.height;

      ctx!.fillStyle = WORLD_BG;
      ctx!.fillRect(0, 0, W, H);

      const camX = you ? you.x - W / 2 : worldRef.current.width / 2;
      const camY = you ? you.y - H / 2 : worldRef.current.height / 2;

      ctx!.save();
      ctx!.translate(-camX, -camY);

      // Ground grid
      ctx!.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx!.lineWidth = 1;
      const gridSize = 80;
      const startX = Math.floor(camX / gridSize) * gridSize;
      const startY = Math.floor(camY / gridSize) * gridSize;
      for (let gx = startX; gx < camX + W + gridSize; gx += gridSize) {
        ctx!.beginPath(); ctx!.moveTo(gx, camY - gridSize); ctx!.lineTo(gx, camY + H + gridSize); ctx!.stroke();
      }
      for (let gy = startY; gy < camY + H + gridSize; gy += gridSize) {
        ctx!.beginPath(); ctx!.moveTo(camX - gridSize, gy); ctx!.lineTo(camX + W + gridSize, gy); ctx!.stroke();
      }

      // World border
      ctx!.strokeStyle = '#0d2417';
      ctx!.lineWidth = 8;
      ctx!.strokeRect(0, 0, worldRef.current.width, worldRef.current.height);

      for (const tree of treesRef.current) {
        if (tree.alive) drawTree(tree);
      }

      // Draw other players first, then self on top
      const myId = meIdRef.current;
      for (const player of playersRef.current) {
        if (player.id !== myId) drawPlayer(player, false);
      }
      for (const player of playersRef.current) {
        if (player.id === myId) drawPlayer(player, true);
      }

      // Floating text
      const now = Date.now();
      floatingRef.current = floatingRef.current.filter((f) => now - f.bornAt < 1000);
      for (const f of floatingRef.current) {
        const t = (now - f.bornAt) / 1000;
        ctx!.save();
        ctx!.globalAlpha = 1 - t;
        ctx!.fillStyle = f.color;
        ctx!.font = `bold ${f.size}px sans-serif`;
        ctx!.textAlign = 'center';
        ctx!.shadowColor = 'rgba(0,0,0,0.6)';
        ctx!.shadowBlur = 3;
        ctx!.fillText(f.text, f.x, f.y - t * 40);
        ctx!.restore();
      }

      ctx!.restore();
    }

    function computeInputVector(): { dx: number; dy: number } {
      if (joystickRef.current.active) {
        return { dx: joystickRef.current.dx, dy: joystickRef.current.dy };
      }
      const keys = keysRef.current;
      let kx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
      let ky = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
      if (kx !== 0 || ky !== 0) {
        const len = Math.hypot(kx, ky);
        return { dx: kx / len, dy: ky / len };
      }
      const dx = mouseRef.current.x - canvas!.width / 2;
      const dy = mouseRef.current.y - canvas!.height / 2;
      const len = Math.hypot(dx, dy);
      return len > 6 ? { dx: dx / len, dy: dy / len } : { dx: 0, dy: 0 };
    }

    function loop() {
      const you = youRef.current;
      if (you) {
        const now = performance.now();
        if (now - lastInputSent > 50) {
          lastInputSent = now;
          socketRef.current?.send({ type: 'input', ...computeInputVector() });
        }
      }
      render();
      raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('touchcancel', handleTouchEnd);
      canvas!.removeEventListener('mousedown', handleClick);
      canvas!.removeEventListener('touchstart', handleChopTap);
    };
  }, [action]);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#173820] select-none">
      <canvas ref={canvasRef} className="block cursor-crosshair" />

      {/* Mobile joystick */}
      {isTouchDevice && (
        <div
          ref={joystickBaseRef}
          className="absolute bottom-8 left-8 w-28 h-28 rounded-full bg-white/10 border-2 border-white/25 backdrop-blur-sm touch-none"
        >
          <div
            ref={joystickKnobRef}
            className="absolute top-1/2 left-1/2 w-12 h-12 -mt-6 -ml-6 rounded-full bg-white/70 border border-white/40 transition-transform duration-75 ease-out"
          />
        </div>
      )}

      {/* ── Top bar ── */}
      <div className="pointer-events-none absolute top-0 left-0 right-0 p-3 flex justify-between items-start gap-2">

        {/* Left: HP + coins + sword */}
        <div className="pointer-events-auto flex flex-col gap-2">
          {/* HP bar */}
          <div className="flex items-center gap-2 bg-black/45 backdrop-blur-sm rounded-full px-4 py-2 border border-white/10">
            <span className="text-red-400 text-sm">❤️</span>
            <div className="flex gap-0.5">
              {Array.from({ length: maxHp }).map((_, i) => (
                <div
                  key={i}
                  className={`w-4 h-3 rounded-sm transition-colors ${
                    i < hp ? 'bg-red-500' : 'bg-white/15'
                  }`}
                />
              ))}
            </div>
          </div>

          {/* Coins */}
          <div className="flex items-center gap-2 bg-black/45 backdrop-blur-sm rounded-full px-4 py-2 border border-white/10">
            <div className="w-4 h-4 rounded-full bg-yellow-400 shadow-inner flex-shrink-0" />
            <span className="text-white font-bold text-base tabular-nums">{coins}</span>
            <span className="text-white/40 text-xs">coins</span>
          </div>

          {/* Sword / buy / upgrades */}
          {swordLevel === 0 ? (
            <button
              onClick={buySword}
              disabled={coins < 1}
              className="px-4 py-2 rounded-full text-sm font-semibold bg-amber-500 hover:bg-amber-400 disabled:bg-gray-600 disabled:cursor-not-allowed text-black transition-colors shadow"
            >
              🗡 Buy Sword — 1 coin
            </button>
          ) : (
            <button
              onClick={() => setShowUpgrades((v) => !v)}
              className="px-4 py-2 rounded-full text-sm font-semibold bg-black/45 hover:bg-black/60 border border-white/10 text-white transition-colors shadow flex items-center gap-2"
            >
              <span>{['', '🪵', '🔩', '⚔️', '✨'][swordLevel]}</span>
              <span>{SWORD_TIERS[swordLevel]?.name}</span>
              <span className="text-white/40 text-xs ml-1">
                {swordLevel < 4 ? '▲ Upgrade' : '★ MAX'}
              </span>
            </button>
          )}
        </div>

        {/* Right: leaderboard */}
        <div className="pointer-events-auto bg-black/45 backdrop-blur-sm rounded-2xl px-4 py-3 border border-white/10 min-w-[150px]">
          <div className="text-white/50 text-xs font-semibold uppercase tracking-wide mb-1.5">Top Blobs</div>
          <div className="flex flex-col gap-1">
            {leaderboard.map((p, i) => (
              <div key={p.id} className="flex items-center justify-between text-sm text-white/90">
                <span className="truncate max-w-[100px]">{i + 1}. {p.name}</span>
                <span className="text-yellow-300 font-semibold tabular-nums">{p.coins}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Upgrade panel ── */}
      {showUpgrades && swordLevel > 0 && (
        <div className="pointer-events-auto absolute top-44 left-3 w-72 bg-black/80 backdrop-blur-md border border-white/15 rounded-2xl p-4 shadow-2xl">
          <div className="flex items-center justify-between mb-3">
            <span className="text-white font-bold text-sm uppercase tracking-wide">Sword Upgrades</span>
            <button onClick={() => setShowUpgrades(false)} className="text-white/40 hover:text-white text-lg leading-none">✕</button>
          </div>
          <div className="flex flex-col gap-2">
            {SWORD_TIERS.slice(1).map((tier) => {
              const owned = swordLevel >= tier.level;
              const isCurrent = swordLevel === tier.level;
              const isNext = tier.level === swordLevel + 1;
              const canAfford = coins >= tier.cost;
              return (
                <div
                  key={tier.level}
                  className={[
                    'rounded-xl p-3 border transition-colors',
                    isCurrent ? 'bg-emerald-800/50 border-emerald-500/60'
                    : owned ? 'bg-white/5 border-white/10 opacity-60'
                    : isNext ? 'bg-white/8 border-amber-500/40'
                    : 'bg-white/5 border-white/5 opacity-40',
                  ].join(' ')}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">{['', '🪵', '🔩', '⚔️', '✨'][tier.level]}</span>
                      <div>
                        <div className="text-white text-sm font-semibold">{tier.name}</div>
                        <div className="text-white/50 text-xs">
                          {tier.damage} dmg / hit{tier.level === 4 ? ' — one-shots trees & players' : ''}
                        </div>
                      </div>
                    </div>
                    {owned ? (
                      <span className="text-emerald-400 text-xs font-bold">{isCurrent ? '✓ Equipped' : '✓ Owned'}</span>
                    ) : isNext ? (
                      <button
                        onClick={() => { upgradeSword(); setShowUpgrades(false); }}
                        disabled={!canAfford}
                        className="px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-500 hover:bg-amber-400 disabled:bg-gray-600 disabled:cursor-not-allowed text-black transition-colors"
                      >
                        {canAfford ? `${tier.cost} 🪙` : `Need ${tier.cost} 🪙`}
                      </button>
                    ) : (
                      <span className="text-white/30 text-xs">{tier.cost} 🪙</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Kill feed (bottom-right) ── */}
      {killToasts.length > 0 && (
        <div className="pointer-events-none absolute bottom-16 right-4 flex flex-col gap-1 items-end">
          {killToasts.map((t) => (
            <div
              key={t.id}
              className={`text-xs px-3 py-1.5 rounded-full backdrop-blur-sm border ${
                t.isMe
                  ? 'bg-amber-900/70 border-amber-500/40 text-amber-200'
                  : 'bg-black/50 border-white/10 text-white/80'
              }`}
            >
              {t.text}
            </div>
          ))}
        </div>
      )}

      {!connected && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60">
          <span className="text-white text-lg animate-pulse">Connecting…</span>
        </div>
      )}

      {/* Context hint */}
      {connected && swordLevel > 0 && (nearEnemy || nearTree) && (
        <div className="pointer-events-none absolute bottom-8 left-1/2 -translate-x-1/2 bg-black/50 text-white text-sm px-4 py-2 rounded-full border border-white/10">
          {nearEnemy
            ? <span>⚔️ Click or <b>Space</b> to attack!</span>
            : <span>🪓 Click or <b>Space</b> to chop</span>}
        </div>
      )}
      {connected && swordLevel === 0 && nearTree && (
        <div className="pointer-events-none absolute bottom-8 left-1/2 -translate-x-1/2 bg-black/50 text-white text-sm px-4 py-2 rounded-full border border-white/10">
          Buy a sword to chop this tree
        </div>
      )}

      <button
        onClick={onExit}
        className="absolute bottom-4 left-4 pointer-events-auto text-white/50 hover:text-white text-xs underline"
      >
        Leave game
      </button>
    </div>
  );
}
