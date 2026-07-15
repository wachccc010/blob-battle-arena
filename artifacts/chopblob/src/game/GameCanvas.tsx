import { useCallback, useEffect, useRef, useState } from 'react';
import { GameSocket } from './network';
import type { PlayerState, ServerMessage, TreeState } from './types';

interface FloatingText {
  id: number;
  x: number;
  y: number;
  text: string;
  color: string;
  bornAt: number;
}

interface GameCanvasProps {
  name: string;
  onExit: () => void;
}

const WORLD_BG = '#1f4d2e';
const CHOP_RANGE_VISUAL = 62;
let floatId = 0;

export default function GameCanvas({ name, onExit }: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const socketRef = useRef<GameSocket | null>(null);
  const meIdRef = useRef<string>('');
  const worldRef = useRef({ width: 3600, height: 3600 });
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
  const [hasSword, setHasSword] = useState(false);
  const [leaderboard, setLeaderboard] = useState<PlayerState[]>([]);
  const [nearTree, setNearTree] = useState(false);
  const [isTouchDevice] = useState(
    () =>
      typeof window !== 'undefined' &&
      (window.matchMedia?.('(pointer: coarse)').matches ||
        navigator.maxTouchPoints > 0),
  );

  const chop = useCallback(() => {
    socketRef.current?.send({ type: 'chop' });
    swordFlashRef.current = Date.now();
  }, []);

  const buySword = useCallback(() => {
    socketRef.current?.send({ type: 'buySword' });
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
        setHasSword(message.you.hasSword);

        const top = [...message.players]
          .sort((a, b) => b.coins - a.coins)
          .slice(0, 5);
        setLeaderboard(top);

        let closest = Infinity;
        for (const tree of message.trees) {
          if (!tree.alive) continue;
          const d = Math.hypot(
            tree.x - message.you.x,
            tree.y - message.you.y,
          );
          if (d < message.you.radius + tree.radius + CHOP_RANGE_VISUAL) {
            closest = Math.min(closest, d);
          }
        }
        setNearTree(closest < Infinity);

        for (const chopEvent of message.chops) {
          floatingRef.current.push({
            id: floatId++,
            x: chopEvent.x,
            y: chopEvent.y - 40,
            text: chopEvent.coinAwarded ? '+1 coin' : 'chop!',
            color: chopEvent.coinAwarded ? '#ffd54a' : '#ffffff',
            bornAt: Date.now(),
          });
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
        chop();
        return;
      }
      switch (e.code) {
        case 'KeyW':
        case 'ArrowUp':
          keysRef.current.up = true;
          break;
        case 'KeyS':
        case 'ArrowDown':
          keysRef.current.down = true;
          break;
        case 'KeyA':
        case 'ArrowLeft':
          keysRef.current.left = true;
          break;
        case 'KeyD':
        case 'ArrowRight':
          keysRef.current.right = true;
          break;
        default:
          return;
      }
      e.preventDefault();
    }
    window.addEventListener('keydown', handleKeyDown);

    function handleKeyUp(e: KeyboardEvent) {
      switch (e.code) {
        case 'KeyW':
        case 'ArrowUp':
          keysRef.current.up = false;
          break;
        case 'KeyS':
        case 'ArrowDown':
          keysRef.current.down = false;
          break;
        case 'KeyA':
        case 'ArrowLeft':
          keysRef.current.left = false;
          break;
        case 'KeyD':
        case 'ArrowRight':
          keysRef.current.right = false;
          break;
        default:
          return;
      }
      e.preventDefault();
    }
    window.addEventListener('keyup', handleKeyUp);

    function handleClick() {
      chop();
    }
    canvas!.addEventListener('mousedown', handleClick);

    function updateJoystickFromTouch(clientX: number, clientY: number) {
      const base = joystickBaseRef.current;
      const knob = joystickKnobRef.current;
      if (!base || !knob) return;
      const rect = base.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const dx = clientX - centerX;
      const dy = clientY - centerY;
      const maxRadius = rect.width / 2;
      const len = Math.hypot(dx, dy);
      const clamped = Math.min(len, maxRadius);
      const nx = len > 0 ? dx / len : 0;
      const ny = len > 0 ? dy / len : 0;
      knob.style.transform = `translate(${nx * clamped}px, ${ny * clamped}px)`;
      const deadZone = 8;
      if (len > deadZone) {
        joystickRef.current.dx = nx;
        joystickRef.current.dy = ny;
      } else {
        joystickRef.current.dx = 0;
        joystickRef.current.dy = 0;
      }
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
        touch.clientX >= rect.left - 40 &&
        touch.clientX <= rect.right + 40 &&
        touch.clientY >= rect.top - 40 &&
        touch.clientY <= rect.bottom + 40;
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
        if (touch.identifier === joystickTouchId.current) {
          resetJoystick();
        }
      }
    }

    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd);
    window.addEventListener('touchcancel', handleTouchEnd);

    function handleChopTap(e: TouchEvent) {
      // A tap outside the joystick zone triggers a chop attempt (mobile has no spacebar).
      const base = joystickBaseRef.current;
      const touch = e.changedTouches[0];
      if (!base || !touch) return;
      const rect = base.getBoundingClientRect();
      const withinZone =
        touch.clientX >= rect.left - 40 &&
        touch.clientX <= rect.right + 40 &&
        touch.clientY >= rect.top - 40 &&
        touch.clientY <= rect.bottom + 40;
      if (withinZone) return;
      chop();
    }
    canvas!.addEventListener('touchstart', handleChopTap, { passive: true });

    function drawTree(tree: TreeState, alpha: number) {
      ctx!.save();
      ctx!.globalAlpha = alpha;
      ctx!.beginPath();
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
      ctx!.arc(
        tree.x - 10,
        tree.y - 20,
        tree.radius * 0.55,
        0,
        Math.PI * 2,
      );
      ctx!.fill();
      ctx!.restore();
    }

    function drawPlayer(player: PlayerState, isYou: boolean) {
      ctx!.save();
      ctx!.translate(player.x, player.y);

      // shadow
      ctx!.beginPath();
      ctx!.fillStyle = 'rgba(0,0,0,0.2)';
      ctx!.ellipse(0, player.radius * 0.7, player.radius * 0.9, player.radius * 0.35, 0, 0, Math.PI * 2);
      ctx!.fill();

      const hue = isYou ? 200 : hashHue(player.id);
      const gradient = ctx!.createRadialGradient(
        -player.radius * 0.3,
        -player.radius * 0.3,
        player.radius * 0.2,
        0,
        0,
        player.radius,
      );
      gradient.addColorStop(0, `hsl(${hue}, 85%, 70%)`);
      gradient.addColorStop(1, `hsl(${hue}, 75%, 48%)`);

      ctx!.beginPath();
      ctx!.fillStyle = gradient;
      ctx!.strokeStyle = isYou ? '#ffffff' : 'rgba(0,0,0,0.25)';
      ctx!.lineWidth = isYou ? 3 : 2;
      ctx!.arc(0, 0, player.radius, 0, Math.PI * 2);
      ctx!.fill();
      ctx!.stroke();

      // eyes
      const eyeOffsetX = Math.cos(player.angle) * player.radius * 0.35;
      const eyeOffsetY = Math.sin(player.angle) * player.radius * 0.35;
      for (const side of [-1, 1]) {
        ctx!.beginPath();
        ctx!.fillStyle = '#ffffff';
        ctx!.ellipse(
          eyeOffsetX + side * player.radius * 0.32,
          eyeOffsetY - player.radius * 0.15,
          player.radius * 0.22,
          player.radius * 0.26,
          0,
          0,
          Math.PI * 2,
        );
        ctx!.fill();
        ctx!.beginPath();
        ctx!.fillStyle = '#1c1c1c';
        ctx!.arc(
          eyeOffsetX + side * player.radius * 0.32 + Math.cos(player.angle) * 2,
          eyeOffsetY - player.radius * 0.15 + Math.sin(player.angle) * 2,
          player.radius * 0.11,
          0,
          Math.PI * 2,
        );
        ctx!.fill();
      }

      if (player.hasSword) {
        ctx!.save();
        ctx!.rotate(player.angle + Math.PI / 4);
        const flashActive = isYou && Date.now() - swordFlashRef.current < 150;
        ctx!.translate(player.radius * (flashActive ? 1.15 : 0.85), 0);
        ctx!.fillStyle = '#d8dee6';
        ctx!.fillRect(-3, -player.radius * 0.9, 6, player.radius * 1.1);
        ctx!.fillStyle = '#8a5a2b';
        ctx!.fillRect(-5, player.radius * 0.1, 10, 8);
        ctx!.restore();
      }

      ctx!.restore();

      ctx!.save();
      ctx!.fillStyle = '#ffffff';
      ctx!.font = 'bold 13px sans-serif';
      ctx!.textAlign = 'center';
      ctx!.shadowColor = 'rgba(0,0,0,0.6)';
      ctx!.shadowBlur = 3;
      ctx!.fillText(player.name, player.x, player.y - player.radius - 12);
      ctx!.restore();
    }

    function hashHue(id: string): number {
      let hash = 0;
      for (let i = 0; i < id.length; i++) {
        hash = (hash * 31 + id.charCodeAt(i)) % 360;
      }
      return hash;
    }

    function render() {
      const you = youRef.current;
      const width = canvas!.width;
      const height = canvas!.height;

      ctx!.fillStyle = WORLD_BG;
      ctx!.fillRect(0, 0, width, height);

      const camX = you ? you.x - width / 2 : worldRef.current.width / 2;
      const camY = you ? you.y - height / 2 : worldRef.current.height / 2;

      ctx!.save();
      ctx!.translate(-camX, -camY);

      // grid pattern for ground
      ctx!.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx!.lineWidth = 1;
      const gridSize = 80;
      const startX = Math.floor(camX / gridSize) * gridSize;
      const startY = Math.floor(camY / gridSize) * gridSize;
      for (let x = startX; x < camX + width + gridSize; x += gridSize) {
        ctx!.beginPath();
        ctx!.moveTo(x, camY - gridSize);
        ctx!.lineTo(x, camY + height + gridSize);
        ctx!.stroke();
      }
      for (let y = startY; y < camY + height + gridSize; y += gridSize) {
        ctx!.beginPath();
        ctx!.moveTo(camX - gridSize, y);
        ctx!.lineTo(camX + width + gridSize, y);
        ctx!.stroke();
      }

      // world border
      ctx!.strokeStyle = '#0d2417';
      ctx!.lineWidth = 8;
      ctx!.strokeRect(0, 0, worldRef.current.width, worldRef.current.height);

      for (const tree of treesRef.current) {
        if (tree.alive) drawTree(tree, 1);
      }

      for (const player of playersRef.current) {
        drawPlayer(player, player.id === meIdRef.current);
      }

      const now = Date.now();
      floatingRef.current = floatingRef.current.filter(
        (f) => now - f.bornAt < 900,
      );
      for (const f of floatingRef.current) {
        const t = (now - f.bornAt) / 900;
        ctx!.save();
        ctx!.globalAlpha = 1 - t;
        ctx!.fillStyle = f.color;
        ctx!.font = 'bold 16px sans-serif';
        ctx!.textAlign = 'center';
        ctx!.fillText(f.text, f.x, f.y - t * 30);
        ctx!.restore();
      }

      ctx!.restore();
    }

    function computeInputVector(): { dx: number; dy: number } {
      // Priority: joystick (mobile) > keyboard (WASD/arrows) > mouse-follow (desktop).
      if (joystickRef.current.active) {
        return { dx: joystickRef.current.dx, dy: joystickRef.current.dy };
      }

      const keys = keysRef.current;
      let kx = 0;
      let ky = 0;
      if (keys.left) kx -= 1;
      if (keys.right) kx += 1;
      if (keys.up) ky -= 1;
      if (keys.down) ky += 1;
      if (kx !== 0 || ky !== 0) {
        const len = Math.hypot(kx, ky);
        return { dx: kx / len, dy: ky / len };
      }

      const dx = mouseRef.current.x - canvas!.width / 2;
      const dy = mouseRef.current.y - canvas!.height / 2;
      const len = Math.hypot(dx, dy);
      const deadZone = 6;
      if (len > deadZone) {
        return { dx: dx / len, dy: dy / len };
      }
      return { dx: 0, dy: 0 };
    }

    function loop() {
      const you = youRef.current;
      if (you) {
        const now = performance.now();
        if (now - lastInputSent > 50) {
          lastInputSent = now;
          const { dx, dy } = computeInputVector();
          socketRef.current?.send({ type: 'input', dx, dy });
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
  }, [chop]);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#173820] select-none">
      <canvas ref={canvasRef} className="block cursor-crosshair" />

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

      <div className="pointer-events-none absolute top-0 left-0 right-0 p-4 flex justify-between items-start">
        <div className="pointer-events-auto flex items-center gap-3 bg-black/40 backdrop-blur-sm rounded-full px-4 py-2 border border-white/10">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-full bg-yellow-400 shadow-inner" />
            <span className="text-white font-bold text-lg tabular-nums">
              {coins}
            </span>
          </div>
          {!hasSword ? (
            <button
              onClick={buySword}
              disabled={coins < 1}
              className="ml-2 px-3 py-1.5 rounded-full text-sm font-semibold bg-amber-500 hover:bg-amber-400 disabled:bg-gray-500 disabled:cursor-not-allowed text-black transition-colors"
            >
              Buy Sword — 1 coin
            </button>
          ) : (
            <span className="ml-2 px-3 py-1.5 rounded-full text-sm font-semibold bg-emerald-600/80 text-white">
              Sword equipped
            </span>
          )}
        </div>

        <div className="pointer-events-auto bg-black/40 backdrop-blur-sm rounded-2xl px-4 py-3 border border-white/10 min-w-[160px]">
          <div className="text-white/60 text-xs font-semibold uppercase tracking-wide mb-1.5">
            Top Blobs
          </div>
          <div className="flex flex-col gap-1">
            {leaderboard.map((p, i) => (
              <div
                key={p.id}
                className="flex items-center justify-between text-sm text-white/90"
              >
                <span className="truncate max-w-[100px]">
                  {i + 1}. {p.name}
                </span>
                <span className="text-yellow-300 font-semibold tabular-nums">
                  {p.coins}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {!connected && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60">
          <span className="text-white text-lg animate-pulse">
            Connecting...
          </span>
        </div>
      )}

      {connected && hasSword && nearTree && (
        <div className="pointer-events-none absolute bottom-8 left-1/2 -translate-x-1/2 bg-black/50 text-white text-sm px-4 py-2 rounded-full border border-white/10">
          Click or press <span className="font-bold">Space</span> to chop
        </div>
      )}

      {connected && !hasSword && nearTree && (
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
