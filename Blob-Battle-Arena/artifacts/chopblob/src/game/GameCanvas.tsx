import { useCallback, useEffect, useRef, useState } from 'react';
import { GameSocket } from './network';
import type { KillEvent, PlayerState, ServerMessage, TreeState } from './types';

// ── Constants ────────────────────────────────────────────────────────────────

const SWORD_TIERS = [
  { level: 0, name: 'None',         damage: 0, cost: 0   },
  { level: 1, name: 'Wooden Sword', damage: 1, cost: 1   },
  { level: 2, name: 'Iron Sword',   damage: 2, cost: 10  },
  { level: 3, name: 'Steel Sword',  damage: 3, cost: 50  },
  { level: 4, name: 'Golden Sword', damage: 5, cost: 100 },
] as const;

const ATTACK_RANGE_VISUAL = 75;
const CHOP_RANGE_VISUAL   = 62;

// Blade: [highlight, shadow, fuller]
const BLADE_CFG: Record<number, [string, string, string]> = {
  1: ['#e0c080', '#9a6030', 'rgba(255,230,150,0.40)'],
  2: ['#e8f0f8', '#7890a8', 'rgba(255,255,255,0.55)'],
  3: ['#90c8f8', '#3870a8', 'rgba(180,230,255,0.50)'],
  4: ['#ffe84d', '#c88010', 'rgba(255,255,180,0.65)'],
};
const GUARD_COLOR: Record<number, string> = {
  1: '#7a4a20', 2: '#5a6878', 3: '#3860a0', 4: '#c09010',
};
const HANDLE_COLOR: Record<number, string> = {
  1: '#5c3010', 2: '#2a2a3a', 3: '#1a2a3a', 4: '#3a2208',
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface FloatingText {
  id: number;
  x: number; y: number;
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

interface Particle {
  id: number;
  x: number; y: number;
  vx: number; vy: number;
  bornAt: number;
  life: number;   // ms
  color: string;
  size: number;
  rotation: number;
  rotV: number;
}

interface GroundPatch { x: number; y: number; rx: number; ry: number; color: string; angle: number }
interface GrassMark   { x: number; y: number; angle: number; len: number }
interface GroundData  { patches: GroundPatch[]; marks: GrassMark[] }

// ── Ground generation (deterministic) ────────────────────────────────────────

function makeRng(seed: number) {
  let s = (seed | 0) >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0xffffffff; };
}

function generateGroundData(worldW: number, worldH: number): GroundData {
  const rng = makeRng(worldW * 7 + worldH * 13 + 42);
  const pColors = ['#1e4d28','#194424','#224f29','#1b4526','#1f4a26','#204d2a'];
  const patches: GroundPatch[] = [];
  for (let i = 0; i < 400; i++) {
    patches.push({
      x: rng() * worldW, y: rng() * worldH,
      rx: 50 + rng() * 140, ry: 28 + rng() * 80,
      color: pColors[Math.floor(rng() * pColors.length)],
      angle: rng() * Math.PI,
    });
  }
  const marks: GrassMark[] = [];
  for (let i = 0; i < 2200; i++) {
    marks.push({
      x: rng() * worldW, y: rng() * worldH,
      angle: rng() * Math.PI,
      len: 6 + rng() * 13,
    });
  }
  return { patches, marks };
}

// ── Component ────────────────────────────────────────────────────────────────

interface GameCanvasProps { name: string; onExit: () => void }

let floatId = 0;

export default function GameCanvas({ name, onExit }: GameCanvasProps) {
  const canvasRef       = useRef<HTMLCanvasElement>(null);
  const socketRef       = useRef<GameSocket | null>(null);
  const meIdRef         = useRef('');
  const worldRef        = useRef({ width: 5600, height: 5600 });
  const playersRef      = useRef<PlayerState[]>([]);
  const treesRef        = useRef<TreeState[]>([]);
  const youRef          = useRef<PlayerState | null>(null);
  const floatingRef     = useRef<FloatingText[]>([]);
  const particlesRef    = useRef<Particle[]>([]);
  const prevPosRef      = useRef<Map<string, { x: number; y: number }>>(new Map());
  const cameraRef       = useRef({ x: 0, y: 0, ready: false });
  const swordFlashRef   = useRef(0);
  const keysRef         = useRef({ up: false, down: false, left: false, right: false });
  const joystickRef     = useRef({ active: false, dx: 0, dy: 0 });
  const joystickTouchId = useRef<number | null>(null);
  const joystickBaseRef = useRef<HTMLDivElement>(null);
  const joystickKnobRef = useRef<HTMLDivElement>(null);
  const groundDataRef   = useRef<GroundData | null>(null);
  const killsRef        = useRef(0);

  const spawnParticles = useCallback((x: number, y: number, type: 'wood' | 'blood' | 'gold') => {
    const palettes = {
      wood:  ['#c8a96e','#a07840','#8b6232','#d4b47c','#b8903c'],
      blood: ['#cc2222','#ee4444','#aa1111','#dd3333'],
      gold:  ['#ffd700','#ffaa00','#ffe44d','#ffc400','#ff8800'],
    };
    const colors = palettes[type];
    const count  = type === 'gold' ? 14 : type === 'blood' ? 7 : 9;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = 65 + Math.random() * 145;
      particlesRef.current.push({
        id: floatId++,
        x, y,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd - 45,
        bornAt: Date.now(),
        life: 550 + Math.random() * 450,
        color: colors[Math.floor(Math.random() * colors.length)],
        size: type === 'wood' ? 3.5 + Math.random() * 4 : 2.5 + Math.random() * 3,
        rotation: Math.random() * Math.PI * 2,
        rotV: (Math.random() - 0.5) * 9,
      });
    }
  }, []);

  const [connected,    setConnected]    = useState(false);
  const [coins,        setCoins]        = useState(1);
  const [hp,           setHp]           = useState(5);
  const [maxHp,        setMaxHp]        = useState(5);
  const [swordLevel,   setSwordLevel]   = useState(0);
  const [kills,        setKills]        = useState(0);
  const [leaderboard,  setLeaderboard]  = useState<PlayerState[]>([]);
  const [nearTree,     setNearTree]     = useState(false);
  const [nearEnemy,    setNearEnemy]    = useState(false);
  const [showUpgrades, setShowUpgrades] = useState(false);
  const [killToasts,   setKillToasts]   = useState<KillToast[]>([]);
  const [isTouchDevice] = useState(
    () => typeof window !== 'undefined' &&
      (window.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 0),
  );

  const action     = useCallback(() => { socketRef.current?.send({ type: 'chop' }); swordFlashRef.current = Date.now(); }, []);
  const buySword   = useCallback(() => { socketRef.current?.send({ type: 'buySword' }); }, []);
  const upgradeSword = useCallback(() => { socketRef.current?.send({ type: 'upgradeSword' }); }, []);

  // Kill-toast cleanup
  useEffect(() => {
    const t = setInterval(() => setKillToasts((p) => p.filter((k) => Date.now() - k.bornAt < 3500)), 500);
    return () => clearInterval(t);
  }, []);

  // WebSocket
  useEffect(() => {
    const socket = new GameSocket();
    socketRef.current = socket;

    socket.onOpen(() => { setConnected(true); socket.send({ type: 'join', name }); });
    socket.onClose(() => setConnected(false));

    socket.onMessage((msg: ServerMessage) => {
      if (msg.type === 'welcome') {
        meIdRef.current = msg.id;
        worldRef.current = msg.world;
        groundDataRef.current = generateGroundData(msg.world.width, msg.world.height);
      } else if (msg.type === 'state') {
        playersRef.current = msg.players;
        treesRef.current   = msg.trees;
        youRef.current     = msg.you;
        setCoins(msg.you.coins);
        setHp(msg.you.hp);
        setMaxHp(msg.you.maxHp);
        setSwordLevel(msg.you.swordLevel);
        setLeaderboard([...msg.players].sort((a, b) => b.coins - a.coins).slice(0, 5));

        // Proximity
        let dTree = Infinity, dEnemy = Infinity;
        for (const tree of msg.trees) {
          if (!tree.alive) continue;
          const d = Math.hypot(tree.x - msg.you.x, tree.y - msg.you.y);
          if (d < msg.you.radius + tree.radius + CHOP_RANGE_VISUAL) dTree = Math.min(dTree, d);
        }
        for (const p of msg.players) {
          if (p.id === meIdRef.current) continue;
          const d = Math.hypot(p.x - msg.you.x, p.y - msg.you.y);
          if (d < msg.you.radius + p.radius + ATTACK_RANGE_VISUAL) dEnemy = Math.min(dEnemy, d);
        }
        setNearTree(dTree < Infinity);
        setNearEnemy(dEnemy < Infinity);

        // Chop events → particles + float
        for (const chop of msg.chops) {
          floatingRef.current.push({
            id: floatId++, x: chop.x, y: chop.y - 36,
            text: chop.coinAwarded ? '+1 🪙' : '🪓',
            color: chop.coinAwarded ? '#ffd54a' : '#d4b47c',
            size: chop.coinAwarded ? 16 : 14, bornAt: Date.now(),
          });
          spawnParticles(chop.x, chop.y, 'wood');
        }

        // Kill events → particles + toasts + float
        for (const kill of (msg.kills as KillEvent[])) {
          const iAmKiller = kill.killerId === meIdRef.current;
          const iAmVictim = kill.victimId === meIdRef.current;
          if (iAmKiller) { killsRef.current++; setKills(killsRef.current); }

          floatingRef.current.push({
            id: floatId++, x: kill.x, y: kill.y - 52,
            text: iAmKiller ? `+${kill.coinsGained} 🪙` : `💀 ${kill.victimName}`,
            color: iAmKiller ? '#ffd700' : '#ff6b6b',
            size: 18, bornAt: Date.now(),
          });
          spawnParticles(kill.x, kill.y, iAmKiller ? 'gold' : 'blood');

          setKillToasts((prev) => [...prev.slice(-4), {
            id: floatId++,
            text: iAmKiller
              ? `⚔️ You slew ${kill.victimName} (+${kill.coinsGained} coins)`
              : iAmVictim
              ? `💀 Slain by ${kill.killerName}! Respawning...`
              : `⚔️ ${kill.killerName} slew ${kill.victimName}`,
            bornAt: Date.now(),
            isMe: iAmKiller || iAmVictim,
          }]);
        }
      }
    });

    socket.connect();
    return () => socket.close();
  }, [name]);

  // Canvas render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    let raf = 0;
    let lastInputSent = 0;
    const dpr = window.devicePixelRatio || 1;

    function resize() {
      const w = window.innerWidth, h = window.innerHeight;
      canvas!.width  = w * dpr;
      canvas!.height = h * dpr;
      canvas!.style.width  = `${w}px`;
      canvas!.style.height = `${h}px`;
      ctx.scale(dpr, dpr);
    }
    resize();
    const onResize = () => resize();
    window.addEventListener('resize', onResize);

    // ── Input ───────────────────────────────────────────────────────────────

    function handleKeyDown(e: KeyboardEvent) {
      if (e.code === 'Space') { e.preventDefault(); action(); return; }
      switch (e.code) {
        case 'KeyW': case 'ArrowUp':    keysRef.current.up    = true; break;
        case 'KeyS': case 'ArrowDown':  keysRef.current.down  = true; break;
        case 'KeyA': case 'ArrowLeft':  keysRef.current.left  = true; break;
        case 'KeyD': case 'ArrowRight': keysRef.current.right = true; break;
        default: return;
      }
      e.preventDefault();
    }
    function handleKeyUp(e: KeyboardEvent) {
      switch (e.code) {
        case 'KeyW': case 'ArrowUp':    keysRef.current.up    = false; break;
        case 'KeyS': case 'ArrowDown':  keysRef.current.down  = false; break;
        case 'KeyA': case 'ArrowLeft':  keysRef.current.left  = false; break;
        case 'KeyD': case 'ArrowRight': keysRef.current.right = false; break;
        default: return;
      }
      e.preventDefault();
    }
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup',   handleKeyUp);

    const onMouseDown = () => action();
    canvas.addEventListener('mousedown', onMouseDown);

    // Joystick
    function updateJoystick(clientX: number, clientY: number) {
      const base = joystickBaseRef.current, knob = joystickKnobRef.current;
      if (!base || !knob) return;
      const r = base.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const dx = clientX - cx, dy = clientY - cy;
      const maxR = r.width / 2;
      const len = Math.hypot(dx, dy);
      const c = Math.min(len, maxR);
      const nx = len > 0 ? dx / len : 0, ny = len > 0 ? dy / len : 0;
      knob.style.transform = `translate(${nx * c}px, ${ny * c}px)`;
      const dead = 8;
      joystickRef.current.dx = len > dead ? nx : 0;
      joystickRef.current.dy = len > dead ? ny : 0;
    }
    function resetJoystick() {
      joystickRef.current = { active: false, dx: 0, dy: 0 };
      joystickTouchId.current = null;
      if (joystickKnobRef.current) joystickKnobRef.current.style.transform = '';
    }
    function onTouchStart(e: TouchEvent) {
      const base = joystickBaseRef.current;
      if (!base || joystickTouchId.current !== null) return;
      const touch = e.changedTouches[0];
      if (!touch) return;
      const r = base.getBoundingClientRect();
      if (touch.clientX < r.left - 40 || touch.clientX > r.right + 40 ||
          touch.clientY < r.top  - 40 || touch.clientY > r.bottom + 40) return;
      joystickTouchId.current = touch.identifier;
      joystickRef.current.active = true;
      updateJoystick(touch.clientX, touch.clientY);
    }
    function onTouchMove(e: TouchEvent) {
      if (joystickTouchId.current === null) return;
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === joystickTouchId.current) { e.preventDefault(); updateJoystick(t.clientX, t.clientY); }
      }
    }
    function onTouchEnd(e: TouchEvent) {
      if (joystickTouchId.current === null) return;
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === joystickTouchId.current) resetJoystick();
      }
    }
    window.addEventListener('touchstart',  onTouchStart,  { passive: true });
    window.addEventListener('touchmove',   onTouchMove,   { passive: false });
    window.addEventListener('touchend',    onTouchEnd);
    window.addEventListener('touchcancel', onTouchEnd);

    function onChopTap(e: TouchEvent) {
      const base = joystickBaseRef.current, touch = e.changedTouches[0];
      if (!base || !touch) return;
      const r = base.getBoundingClientRect();
      if (touch.clientX >= r.left - 40 && touch.clientX <= r.right + 40 &&
          touch.clientY >= r.top  - 40 && touch.clientY <= r.bottom + 40) return;
      action();
    }
    canvas.addEventListener('touchstart', onChopTap, { passive: true });

    // ── Drawing helpers ─────────────────────────────────────────────────────

    function drawGround(camX: number, camY: number, W: number, H: number) {
      const gd = groundDataRef.current;
      const world = worldRef.current;
      if (!gd) return;

      // Subtle ground patches
      for (const p of gd.patches) {
        const sx = p.x - camX, sy = p.y - camY;
        if (sx < -250 || sx > W + 250 || sy < -150 || sy > H + 150) continue;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.beginPath();
        ctx.ellipse(0, 0, p.rx, p.ry, 0, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();
        ctx.restore();
      }

      // Grass marks
      ctx.lineWidth = 1.4;
      for (const m of gd.marks) {
        const sx = m.x - camX, sy = m.y - camY;
        if (sx < -20 || sx > W + 20 || sy < -20 || sy > H + 20) continue;
        ctx.save();
        ctx.strokeStyle = 'rgba(20,70,30,0.4)';
        ctx.translate(m.x, m.y);
        ctx.rotate(m.angle);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(2.5, -m.len * 0.55, 0, -m.len);
        ctx.stroke();
        ctx.restore();
      }

      // Grid
      ctx.strokeStyle = 'rgba(0,0,0,0.055)';
      ctx.lineWidth = 1;
      const gs = 100;
      const gx0 = Math.floor(camX / gs) * gs, gy0 = Math.floor(camY / gs) * gs;
      for (let gx = gx0; gx < camX + W + gs; gx += gs) {
        ctx.beginPath(); ctx.moveTo(gx, camY - 5); ctx.lineTo(gx, camY + H + 5); ctx.stroke();
      }
      for (let gy = gy0; gy < camY + H + gs; gy += gs) {
        ctx.beginPath(); ctx.moveTo(camX - 5, gy); ctx.lineTo(camX + W + 5, gy); ctx.stroke();
      }

      // World border
      ctx.strokeStyle = '#0a1e10';
      ctx.lineWidth = 10;
      ctx.strokeRect(0, 0, world.width, world.height);

      // Out-of-bounds shading
      const bx = camX, by = camY;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      if (bx > 0)                   ctx.fillRect(camX, camY, -bx, H);
      if (by > 0)                   ctx.fillRect(camX, camY, W, -by);
      if (bx + W > world.width)     ctx.fillRect(world.width, camY, (bx + W) - world.width, H);
      if (by + H > world.height)    ctx.fillRect(camX, world.height, W, (by + H) - world.height);
    }

    function drawTree(tree: TreeState, camX: number, camY: number, W: number, H: number) {
      const sx = tree.x - camX, sy = tree.y - camY;
      if (sx < -100 || sx > W + 100 || sy < -100 || sy > H + 100) return;
      const { x, y, radius: r, hp: thp, maxHp } = tree;
      const ratio = thp / maxHp;

      // Shadow
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.beginPath();
      ctx.ellipse(x + 10, y + r * 0.36, r * 0.88, r * 0.28, 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Trunk
      ctx.save();
      ctx.fillStyle = '#3a2b1c';
      ctx.beginPath();
      ctx.roundRect(x - 7, y - 4, 14, 32, 4);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,190,120,0.12)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x - 2, y - 2); ctx.lineTo(x - 1.5, y + 22); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + 3, y); ctx.lineTo(x + 2.5, y + 18); ctx.stroke();
      ctx.restore();

      // Canopy layers
      const [c0, c1, c2] = ratio > 0.66
        ? ['#235f2d', '#2a8038', '#35a044']
        : ratio > 0.33
        ? ['#3a7028', '#4a9034', '#5aaa40']
        : ['#5a8030', '#70a040', '#8ec455'];

      ctx.save();
      ctx.fillStyle = c0;
      ctx.beginPath(); ctx.arc(x - 9, y - 18, r * 0.7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = c0;
      ctx.beginPath(); ctx.arc(x + 8, y - 14, r * 0.65, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = c1;
      ctx.beginPath(); ctx.arc(x, y - 14, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = c2;
      ctx.beginPath(); ctx.arc(x + 4, y - 24, r * 0.56, 0, Math.PI * 2); ctx.fill();
      // Sheen
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.beginPath(); ctx.arc(x + 5, y - 27, r * 0.32, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    function hashHue(id: string) {
      let h = 0;
      for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
      return h;
    }

    function drawSword(x: number, y: number, r: number, angle: number, sl: number, isYou: boolean) {
      const flash = isYou && Date.now() - swordFlashRef.current < 200;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle + Math.PI / 4 + (flash ? -0.4 : 0));
      ctx.translate(r * 0.9 + (flash ? r * 0.22 : 0), 0);

      const bLen = r * (1.1 + sl * 0.18);
      const [bHi, bLo, bFul] = BLADE_CFG[sl] ?? ['#d8dee6', '#8090a0', 'rgba(255,255,255,0.3)'];

      // Blade
      const bg = ctx.createLinearGradient(-3, 0, 3, 0);
      bg.addColorStop(0, bLo); bg.addColorStop(0.45, bHi); bg.addColorStop(1, bLo);
      ctx.beginPath();
      ctx.moveTo(0, -bLen);
      ctx.lineTo(2.8, -bLen * 0.2);
      ctx.lineTo(-2.8, -bLen * 0.2);
      ctx.closePath();
      ctx.fillStyle = bg; ctx.fill();

      // Fuller
      ctx.beginPath();
      ctx.moveTo(0, -bLen + 5); ctx.lineTo(0.7, -bLen * 0.25); ctx.lineTo(-0.7, -bLen * 0.25);
      ctx.closePath(); ctx.fillStyle = bFul; ctx.fill();

      // Crossguard
      const gW = sl === 4 ? 16 : 13;
      ctx.fillStyle = GUARD_COLOR[sl] ?? '#607080';
      ctx.beginPath(); ctx.roundRect(-gW / 2, -bLen * 0.2 - 3.5, gW, 7, 3); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(-gW / 2 + 2, -bLen * 0.2); ctx.lineTo(gW / 2 - 2, -bLen * 0.2); ctx.stroke();

      // Handle
      const hLen = 12 + sl * 1.6;
      ctx.fillStyle = HANDLE_COLOR[sl] ?? '#2a2a3a';
      ctx.beginPath(); ctx.roundRect(-3.5, -bLen * 0.2 + 3.5, 7, hLen, 3); ctx.fill();
      ctx.strokeStyle = sl >= 2 ? 'rgba(255,255,255,0.18)' : 'rgba(180,120,60,0.4)'; ctx.lineWidth = 1.2;
      for (let i = 0; i < Math.floor(hLen / 4); i++) {
        const gy = -bLen * 0.2 + 5.5 + i * 4;
        ctx.beginPath(); ctx.moveTo(-3.5, gy); ctx.lineTo(3.5, gy); ctx.stroke();
      }

      // Pommel
      ctx.fillStyle = bHi;
      ctx.beginPath(); ctx.arc(0, -bLen * 0.2 + 3.5 + hLen + 4, sl === 4 ? 5.5 : 4.5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = bLo; ctx.lineWidth = 1; ctx.stroke();

      // Swing glow
      if (flash) {
        ctx.globalAlpha = 0.55;
        ctx.shadowColor = bHi; ctx.shadowBlur = 18;
        ctx.fillStyle = bHi;
        ctx.beginPath();
        ctx.moveTo(0, -bLen); ctx.lineTo(2, -bLen * 0.2); ctx.lineTo(-2, -bLen * 0.2);
        ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 1; ctx.shadowBlur = 0;
      }
      ctx.restore();
    }

    function drawPlayer(p: PlayerState, isYou: boolean, camX: number, camY: number, W: number, H: number) {
      const sx = p.x - camX, sy = p.y - camY;
      if (sx < -100 || sx > W + 100 || sy < -100 || sy > H + 100) return;

      const { x, y, radius: r, angle, swordLevel: sl, hp: phHp, maxHp: phMaxHp } = p;

      // Squish from velocity
      const prev = prevPosRef.current.get(p.id);
      let sX = 1, sY = 1;
      if (prev) {
        const spd = Math.hypot(x - prev.x, y - prev.y);
        if (spd > 0.4) {
          const sq = Math.min(spd * 0.013, 0.2);
          sX = 1 + sq; sY = 1 - sq * 0.55;
        }
      }
      prevPosRef.current.set(p.id, { x, y });

      // Shadow
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.beginPath();
      ctx.ellipse(x + 5, y + r * 0.78, r * 0.82 * sX, r * 0.28, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Body (squish-transformed)
      const hue = isYou ? 200 : hashHue(p.id);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle); ctx.scale(sX, sY); ctx.rotate(-angle);

      // Rim glow
      const rim = ctx.createRadialGradient(0, 0, r * 0.55, 0, 0, r * 1.08);
      rim.addColorStop(0, 'rgba(0,0,0,0)');
      rim.addColorStop(1, `hsla(${hue},80%,62%,0.38)`);
      ctx.beginPath(); ctx.arc(0, 0, r * 1.08, 0, Math.PI * 2);
      ctx.fillStyle = rim; ctx.fill();

      // Body fill
      const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.08, 0, 0, r);
      g.addColorStop(0, `hsl(${hue},90%,76%)`);
      g.addColorStop(0.55, `hsl(${hue},80%,57%)`);
      g.addColorStop(1, `hsl(${hue},68%,36%)`);
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.strokeStyle = isYou ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.28)';
      ctx.lineWidth = isYou ? 2.5 : 1.5;
      ctx.fill(); ctx.stroke();

      // Specular
      ctx.fillStyle = 'rgba(255,255,255,0.26)';
      ctx.beginPath();
      ctx.ellipse(-r * 0.28, -r * 0.3, r * 0.33, r * 0.22, -0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore(); // end squish

      // Eyes (no squish)
      ctx.save();
      ctx.translate(x, y);
      const fwd = r * 0.36;
      const edx = Math.cos(angle) * fwd, edy = Math.sin(angle) * fwd;
      for (const side of [-1, 1] as const) {
        const px = edx + (-Math.sin(angle)) * r * 0.27 * side;
        const py = edy + ( Math.cos(angle)) * r * 0.27 * side;
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.ellipse(px, py - r * 0.04, r * 0.2, r * 0.24, angle, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = `hsl(${hue},70%,28%)`;
        ctx.beginPath();
        ctx.arc(px + Math.cos(angle)*2, py - r*0.04 + Math.sin(angle)*2, r*0.12, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = '#111';
        ctx.beginPath();
        ctx.arc(px + Math.cos(angle)*2.5, py - r*0.04 + Math.sin(angle)*2.5, r*0.07, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.82)';
        ctx.beginPath();
        ctx.arc(px + Math.cos(angle)*1.2 - 1, py - r*0.07 + Math.sin(angle)*1.2, r*0.038, 0, Math.PI*2); ctx.fill();
      }
      ctx.restore();

      // Sword
      if (sl > 0) drawSword(x, y, r, angle, sl, isYou);

      // Name pill
      ctx.save();
      ctx.font = `bold 12px 'Inter',system-ui,sans-serif`;
      ctx.textAlign = 'center';
      const nW = ctx.measureText(p.name).width;
      const nY = y - r - 24;
      ctx.fillStyle = 'rgba(0,0,0,0.52)';
      ctx.beginPath(); ctx.roundRect(x - nW/2 - 7, nY - 10, nW + 14, 16, 8); ctx.fill();
      ctx.fillStyle = isYou ? '#ffffff' : 'rgba(255,255,255,0.88)';
      ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 2;
      ctx.fillText(p.name, x, nY);
      ctx.restore();

      // HP pips
      const pipTotalW = Math.max(r * 2.4, 44);
      const pipW = (pipTotalW - (phMaxHp - 1) * 2) / phMaxHp;
      const pipX0 = x - pipTotalW / 2;
      const pipY  = y - r - 13;
      const hpRatio = phHp / phMaxHp;
      const pipFill = hpRatio > 0.6 ? '#4ade80' : hpRatio > 0.3 ? '#facc15' : '#ef4444';
      for (let i = 0; i < phMaxHp; i++) {
        const px = pipX0 + i * (pipW + 2);
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.42)';
        ctx.beginPath(); ctx.roundRect(px - 0.5, pipY - 0.5, pipW + 1, 5, 2); ctx.fill();
        ctx.fillStyle = i < phHp ? pipFill : 'rgba(60,60,60,0.6)';
        ctx.beginPath(); ctx.roundRect(px, pipY, pipW, 4, 1.5); ctx.fill();
        ctx.restore();
      }
    }

    function drawParticles(camX: number, camY: number) {
      const now = Date.now();
      particlesRef.current = particlesRef.current.filter((p) => now - p.bornAt < p.life);
      for (const p of particlesRef.current) {
        const age = (now - p.bornAt) / 1000;
        const t = (now - p.bornAt) / p.life;
        const px = p.x + p.vx * age;
        const py = p.y + p.vy * age + 0.5 * 220 * age * age;
        const sx = px - camX, sy = py - camY;
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - t * t * 1.4);
        ctx.translate(sx, sy);
        ctx.rotate(p.rotation + p.rotV * age);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.rect(-p.size / 2, -p.size * 0.35, p.size, p.size * 0.7);
        ctx.fill();
        ctx.restore();
      }
    }

    // ── Render ───────────────────────────────────────────────────────────────

    function render() {
      const you = youRef.current;
      const W = canvas!.width / dpr;
      const H = canvas!.height / dpr;

      // Smooth camera
      const cam = cameraRef.current;
      const tX = you ? you.x - W / 2 : worldRef.current.width / 2;
      const tY = you ? you.y - H / 2 : worldRef.current.height / 2;
      if (!cam.ready) { cam.x = tX; cam.y = tY; cam.ready = true; }
      else { cam.x += (tX - cam.x) * 0.11; cam.y += (tY - cam.y) * 0.11; }
      const camX = cam.x, camY = cam.y;

      // Background
      ctx.fillStyle = '#1a3d23';
      ctx.fillRect(0, 0, W, H);

      ctx.save();
      ctx.translate(-camX, -camY);

      drawGround(camX, camY, W, H);

      for (const tree of treesRef.current) {
        if (tree.alive) drawTree(tree, camX, camY, W, H);
      }

      drawParticles(camX, camY);

      const myId = meIdRef.current;
      for (const pl of playersRef.current) { if (pl.id !== myId) drawPlayer(pl, false, camX, camY, W, H); }
      for (const pl of playersRef.current) { if (pl.id === myId) drawPlayer(pl, true,  camX, camY, W, H); }

      // Floating text
      const now = Date.now();
      floatingRef.current = floatingRef.current.filter((f) => now - f.bornAt < 1300);
      for (const f of floatingRef.current) {
        const t = (now - f.bornAt) / 1300;
        const scale = t < 0.08 ? t / 0.08 * 1.25 : t < 0.18 ? 1.25 - (t - 0.08) / 0.1 * 0.25 : 1;
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - t * t * 1.6);
        ctx.translate(f.x, f.y - t * 55);
        ctx.scale(scale, scale);
        ctx.fillStyle = f.color;
        ctx.font = `bold ${f.size}px 'Inter',system-ui,sans-serif`;
        ctx.textAlign = 'center';
        ctx.shadowColor = 'rgba(0,0,0,0.75)';
        ctx.shadowBlur = 5;
        ctx.fillText(f.text, 0, 0);
        ctx.restore();
      }

      ctx.restore();
    }

    // ── Input vector (no mouse fallback → stops on release) ─────────────────

    function inputVector(): { dx: number; dy: number } {
      if (joystickRef.current.active) {
        return { dx: joystickRef.current.dx, dy: joystickRef.current.dy };
      }
      const k = keysRef.current;
      const kx = (k.right ? 1 : 0) - (k.left ? 1 : 0);
      const ky = (k.down  ? 1 : 0) - (k.up   ? 1 : 0);
      if (kx !== 0 || ky !== 0) {
        const len = Math.hypot(kx, ky);
        return { dx: kx / len, dy: ky / len };
      }
      return { dx: 0, dy: 0 };
    }

    function loop() {
      const now = performance.now();
      if (youRef.current && now - lastInputSent > 50) {
        lastInputSent = now;
        socketRef.current?.send({ type: 'input', ...inputVector() });
      }
      render();
      raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup',   handleKeyUp);
      window.removeEventListener('touchstart',  onTouchStart);
      window.removeEventListener('touchmove',   onTouchMove);
      window.removeEventListener('touchend',    onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('touchstart', onChopTap);
    };
  }, [action]);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#1a3d23] select-none">
      <canvas ref={canvasRef} className="block cursor-crosshair" />

      {/* Mobile joystick */}
      {isTouchDevice && (
        <div
          ref={joystickBaseRef}
          className="absolute bottom-10 left-8 w-32 h-32 rounded-full border-2 border-white/20 touch-none"
          style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.04) 100%)' }}
        >
          <div
            ref={joystickKnobRef}
            className="absolute top-1/2 left-1/2 w-14 h-14 -mt-7 -ml-7 rounded-full border border-white/30"
            style={{
              background: 'radial-gradient(circle at 35% 35%, rgba(255,255,255,0.55), rgba(255,255,255,0.2))',
              boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
              transition: 'transform 60ms ease-out',
            }}
          />
        </div>
      )}

      {/* ── Top bar ── */}
      <div className="pointer-events-none absolute top-0 left-0 right-0 p-3 flex justify-between items-start gap-3">

        {/* Left stats */}
        <div className="pointer-events-auto flex flex-col gap-2">

          {/* HP */}
          <div className="flex items-center gap-2 px-3 py-2 rounded-2xl border border-white/10"
               style={{ background: 'rgba(0,0,0,0.52)', backdropFilter: 'blur(8px)' }}>
            <span className="text-red-400 text-sm leading-none">❤️</span>
            <div className="flex gap-1">
              {Array.from({ length: maxHp }).map((_, i) => (
                <div key={i} className={`w-3.5 h-2.5 rounded-sm transition-all ${i < hp ? 'bg-red-500 shadow-sm' : 'bg-white/12'}`} />
              ))}
            </div>
          </div>

          {/* Coins + kills */}
          <div className="flex gap-2">
            <div className="flex items-center gap-1.5 px-3 py-2 rounded-2xl border border-white/10"
                 style={{ background: 'rgba(0,0,0,0.52)', backdropFilter: 'blur(8px)' }}>
              <div className="w-3.5 h-3.5 rounded-full bg-yellow-400 flex-shrink-0" style={{ boxShadow: '0 0 6px rgba(250,200,0,0.5)' }} />
              <span className="text-white font-bold text-sm tabular-nums">{coins}</span>
            </div>
            {kills > 0 && (
              <div className="flex items-center gap-1.5 px-3 py-2 rounded-2xl border border-white/10"
                   style={{ background: 'rgba(0,0,0,0.52)', backdropFilter: 'blur(8px)' }}>
                <span className="text-sm">⚔️</span>
                <span className="text-amber-300 font-bold text-sm tabular-nums">{kills}</span>
              </div>
            )}
          </div>

          {/* Sword button */}
          {swordLevel === 0 ? (
            <button onClick={buySword} disabled={coins < 1}
              className="px-4 py-2 rounded-2xl text-sm font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: coins >= 1 ? 'rgba(245,158,11,0.9)' : 'rgba(80,80,80,0.7)', color: coins >= 1 ? '#1a0a00' : '#aaa' }}>
              🗡 Buy Sword — 1 🪙
            </button>
          ) : (
            <button onClick={() => setShowUpgrades((v) => !v)}
              className="flex items-center gap-2 px-4 py-2 rounded-2xl text-sm font-semibold border border-white/10 transition-all"
              style={{ background: 'rgba(0,0,0,0.52)', backdropFilter: 'blur(8px)', color: '#fff' }}>
              <span>{['', '🪵', '🔩', '⚔️', '✨'][swordLevel]}</span>
              <span>{SWORD_TIERS[swordLevel]?.name}</span>
              <span className="text-white/40 text-xs ml-1">{swordLevel < 4 ? '▲ Upgrade' : '★ MAX'}</span>
            </button>
          )}
        </div>

        {/* Leaderboard */}
        <div className="pointer-events-auto px-4 py-3 rounded-2xl border border-white/10 min-w-[160px]"
             style={{ background: 'rgba(0,0,0,0.52)', backdropFilter: 'blur(8px)' }}>
          <div className="text-white/45 text-xs font-semibold uppercase tracking-widest mb-2">Top Blobs</div>
          <div className="flex flex-col gap-1.5">
            {leaderboard.map((p, i) => (
              <div key={p.id} className="flex items-center justify-between gap-3 text-sm">
                <span className={`truncate max-w-[108px] ${p.id === meIdRef.current ? 'text-white font-bold' : 'text-white/80'}`}>
                  {i === 0 ? '👑' : `${i + 1}.`} {p.name}
                </span>
                <span className="text-yellow-300 font-bold tabular-nums text-xs">{p.coins}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Upgrade panel ── */}
      {showUpgrades && swordLevel > 0 && (
        <div className="pointer-events-auto absolute top-48 left-3 w-76 rounded-2xl border border-white/12 p-4 shadow-2xl"
             style={{ background: 'rgba(8,20,12,0.88)', backdropFilter: 'blur(12px)', width: '290px' }}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-white font-bold text-sm uppercase tracking-wide">⚔️ Upgrades</span>
            <button onClick={() => setShowUpgrades(false)} className="text-white/40 hover:text-white text-lg leading-none w-6 h-6 flex items-center justify-center">✕</button>
          </div>
          <div className="flex flex-col gap-2">
            {SWORD_TIERS.slice(1).map((tier) => {
              const owned = swordLevel >= tier.level;
              const isCurrent = swordLevel === tier.level;
              const isNext = tier.level === swordLevel + 1;
              const canAfford = coins >= tier.cost;
              return (
                <div key={tier.level} className={[
                  'rounded-xl p-3 border transition-colors',
                  isCurrent ? 'border-emerald-500/50' : owned ? 'border-white/8 opacity-55' : isNext ? 'border-amber-500/35' : 'border-white/5 opacity-35',
                ].join(' ')}
                style={{ background: isCurrent ? 'rgba(34,100,50,0.35)' : isNext ? 'rgba(50,35,5,0.4)' : 'rgba(255,255,255,0.03)' }}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">{['', '🪵', '🔩', '⚔️', '✨'][tier.level]}</span>
                      <div>
                        <div className="text-white text-sm font-semibold">{tier.name}</div>
                        <div className="text-white/45 text-xs">{tier.damage} dmg/hit</div>
                      </div>
                    </div>
                    {owned ? (
                      <span className={`text-xs font-bold ${isCurrent ? 'text-emerald-400' : 'text-white/40'}`}>
                        {isCurrent ? '✓ Equipped' : '✓'}
                      </span>
                    ) : isNext ? (
                      <button onClick={() => { upgradeSword(); setShowUpgrades(false); }} disabled={!canAfford}
                        className="px-3 py-1.5 rounded-lg text-xs font-bold transition-colors disabled:cursor-not-allowed"
                        style={{ background: canAfford ? 'rgba(245,158,11,0.9)' : 'rgba(60,60,60,0.7)', color: canAfford ? '#1a0a00' : '#777' }}>
                        {canAfford ? `${tier.cost} 🪙` : `Need ${tier.cost} 🪙`}
                      </button>
                    ) : (
                      <span className="text-white/25 text-xs">{tier.cost} 🪙</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Kill feed ── */}
      {killToasts.length > 0 && (
        <div className="pointer-events-none absolute bottom-16 right-4 flex flex-col gap-1.5 items-end">
          {killToasts.map((t) => (
            <div key={t.id} className="text-xs px-3 py-1.5 rounded-full border"
                 style={{
                   background: t.isMe ? 'rgba(120,80,0,0.75)' : 'rgba(0,0,0,0.55)',
                   borderColor: t.isMe ? 'rgba(245,158,11,0.4)' : 'rgba(255,255,255,0.1)',
                   color: t.isMe ? '#fde68a' : 'rgba(255,255,255,0.78)',
                   backdropFilter: 'blur(6px)',
                 }}>
              {t.text}
            </div>
          ))}
        </div>
      )}

      {/* ── Context hint ── */}
      {connected && swordLevel > 0 && (nearEnemy || nearTree) && (
        <div className="pointer-events-none absolute bottom-8 left-1/2 -translate-x-1/2 text-sm px-4 py-2 rounded-full border border-white/10"
             style={{ background: 'rgba(0,0,0,0.58)', color: '#fff', backdropFilter: 'blur(6px)' }}>
          {nearEnemy
            ? <span>⚔️ <b>Click</b> or <b>Space</b> to attack!</span>
            : <span>🪓 <b>Click</b> or <b>Space</b> to chop</span>}
        </div>
      )}
      {connected && swordLevel === 0 && nearTree && (
        <div className="pointer-events-none absolute bottom-8 left-1/2 -translate-x-1/2 text-sm px-4 py-2 rounded-full border border-white/10"
             style={{ background: 'rgba(0,0,0,0.58)', color: 'rgba(255,255,255,0.7)', backdropFilter: 'blur(6px)' }}>
          Buy a sword to chop trees
        </div>
      )}

      {/* ── Connecting overlay ── */}
      {!connected && (
        <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.65)' }}>
          <div className="text-white text-lg animate-pulse font-semibold">Connecting…</div>
        </div>
      )}

      <button onClick={onExit}
        className="absolute bottom-3 right-4 pointer-events-auto text-white/35 hover:text-white/70 text-xs transition-colors">
        Leave game
      </button>
    </div>
  );
}

