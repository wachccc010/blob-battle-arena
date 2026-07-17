import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { useEffect, useRef, useState } from 'react';
import GameCanvas from '@/game/GameCanvas';
import { buildApiUrl } from '@/game/network';

const queryClient = new QueryClient();

type Screen = 'home' | 'lobby' | 'join' | 'playing';

// ── Helpers ───────────────────────────────────────────────────────────────────

function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  // Fallback for older browsers / insecure contexts
  const el = document.createElement('textarea');
  el.value = text;
  el.style.cssText = 'position:fixed;opacity:0';
  document.body.appendChild(el);
  el.select();
  document.execCommand('copy');
  document.body.removeChild(el);
  return Promise.resolve();
}

function makeInviteUrl(lobbyCode: string): string {
  return `${window.location.origin}${window.location.pathname}?lobby=${lobbyCode}`;
}

async function createLobby(): Promise<string> {
  const res = await fetch(buildApiUrl('/lobbies'), { method: 'POST' });
  if (!res.ok) throw new Error('Failed to create lobby');
  const data = await res.json() as { code: string };
  return data.code;
}

// ── Home screen ───────────────────────────────────────────────────────────────

function HomeScreen({
  name, setName,
  onPlayPublic, onCreateParty, onJoinCode,
}: {
  name: string;
  setName: (n: string) => void;
  onPlayPublic: () => void;
  onCreateParty: () => void;
  onJoinCode: () => void;
}) {
  const [creating, setCreating] = useState(false);

  async function handleCreate() {
    setCreating(true);
    try { await onCreateParty(); }
    finally { setCreating(false); }
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center px-4"
         style={{ background: 'linear-gradient(135deg, #0a1e10 0%, #173820 50%, #1f4d2e 100%)' }}>
      <div className="w-full max-w-sm rounded-3xl p-8 shadow-2xl border border-white/10"
           style={{ background: 'rgba(0,0,0,0.40)', backdropFilter: 'blur(12px)' }}>

        <h1 className="text-4xl font-extrabold text-white text-center tracking-tight">
          ChopBlob<span className="text-amber-400">.io</span>
        </h1>
        <p className="text-white/50 text-center text-sm mt-2 mb-7">
          Chop trees · Buy swords · Slay enemies
        </p>

        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onPlayPublic(); }}
          placeholder="Enter your name"
          maxLength={16}
          className="w-full rounded-xl bg-white/10 border border-white/20 text-white placeholder-white/35
                     px-4 py-3 text-center text-lg outline-none focus:border-amber-400 transition-colors mb-3"
        />

        {/* Play Now */}
        <button onClick={onPlayPublic}
          className="w-full rounded-xl font-bold text-lg py-3 transition-colors mb-2"
          style={{ background: 'rgba(245,158,11,0.9)', color: '#1a0a00' }}>
          Play Now
        </button>

        {/* Create Party */}
        <button onClick={handleCreate} disabled={creating}
          className="w-full rounded-xl font-bold text-base py-2.5 transition-colors border border-white/15 disabled:opacity-60"
          style={{ background: 'rgba(255,255,255,0.08)', color: '#fff' }}>
          {creating ? 'Creating…' : '🔗 Create Private Party'}
        </button>

        <div className="flex items-center my-4">
          <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.08)' }} />
          <span className="px-3 text-white/30 text-xs">or</span>
          <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.08)' }} />
        </div>

        <button onClick={onJoinCode}
          className="w-full text-center text-white/45 hover:text-white/80 text-sm transition-colors">
          Join with a Party Code →
        </button>

        <p className="text-white/25 text-center text-xs mt-6">
          WASD / joystick to move · Stop when you stop · Space to attack
        </p>
      </div>
    </div>
  );
}

// ── Join-with-code screen ─────────────────────────────────────────────────────

function JoinScreen({
  onJoin, onBack,
}: {
  onJoin: (code: string) => void;
  onBack: () => void;
}) {
  const [code, setCode] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 6);
    setCode(v);
  }

  function handleJoin() {
    const trimmed = code.trim();
    if (trimmed.length >= 4) onJoin(trimmed);
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center px-4"
         style={{ background: 'linear-gradient(135deg, #0a1e10 0%, #173820 50%, #1f4d2e 100%)' }}>
      <div className="w-full max-w-sm rounded-3xl p-8 shadow-2xl border border-white/10"
           style={{ background: 'rgba(0,0,0,0.40)', backdropFilter: 'blur(12px)' }}>

        <button onClick={onBack} className="text-white/40 hover:text-white text-sm mb-5 flex items-center gap-1 transition-colors">
          ← Back
        </button>

        <h2 className="text-2xl font-bold text-white text-center mb-2">Join a Party</h2>
        <p className="text-white/45 text-center text-sm mb-6">Enter the 6-character party code</p>

        <input
          ref={inputRef}
          value={code}
          onChange={handleChange}
          onKeyDown={(e) => { if (e.key === 'Enter') handleJoin(); }}
          placeholder="XXXXXX"
          className="w-full rounded-xl bg-white/10 border border-white/20 text-white placeholder-white/25
                     px-4 py-3 text-center text-2xl font-mono font-bold tracking-widest uppercase
                     outline-none focus:border-amber-400 transition-colors mb-4"
        />

        <button onClick={handleJoin} disabled={code.length < 4}
          className="w-full rounded-xl font-bold text-base py-3 transition-colors disabled:opacity-40"
          style={{ background: 'rgba(245,158,11,0.9)', color: '#1a0a00' }}>
          Join Party →
        </button>
      </div>
    </div>
  );
}

// ── Lobby screen ──────────────────────────────────────────────────────────────

function LobbyScreen({
  lobbyCode, name, setName, onPlay, onLeave,
}: {
  lobbyCode: string;
  name: string;
  setName: (n: string) => void;
  onPlay: () => void;
  onLeave: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const inviteUrl = makeInviteUrl(lobbyCode);

  async function handleCopy() {
    await copyToClipboard(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center px-4"
         style={{ background: 'linear-gradient(135deg, #0a1e10 0%, #173820 50%, #1f4d2e 100%)' }}>
      <div className="w-full max-w-sm rounded-3xl p-8 shadow-2xl border border-amber-500/20"
           style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(12px)' }}>

        {/* Header */}
        <div className="text-center mb-6">
          <div className="text-amber-400/70 text-xs font-semibold uppercase tracking-widest mb-1">Private Party</div>
          <h2 className="text-3xl font-extrabold text-white tracking-tight">
            ChopBlob<span className="text-amber-400">.io</span>
          </h2>
        </div>

        {/* Lobby code */}
        <div className="rounded-2xl p-4 mb-4 text-center border border-amber-500/25"
             style={{ background: 'rgba(245,158,11,0.08)' }}>
          <div className="text-white/45 text-xs font-semibold uppercase tracking-widest mb-1">Party Code</div>
          <div className="text-4xl font-mono font-black text-amber-300 tracking-[0.2em]">
            {lobbyCode}
          </div>
        </div>

        {/* Invite link */}
        <div className="mb-5">
          <div className="text-white/40 text-xs mb-1.5">Invite link</div>
          <div className="flex gap-2">
            <div className="flex-1 rounded-xl px-3 py-2 border border-white/12 text-white/50 text-xs truncate font-mono"
                 style={{ background: 'rgba(255,255,255,0.04)' }}>
              {inviteUrl}
            </div>
            <button onClick={handleCopy}
              className="px-3 py-2 rounded-xl text-xs font-bold transition-all border flex-shrink-0"
              style={{
                background: copied ? 'rgba(74,222,128,0.2)' : 'rgba(245,158,11,0.15)',
                borderColor: copied ? 'rgba(74,222,128,0.4)' : 'rgba(245,158,11,0.3)',
                color: copied ? '#4ade80' : '#fbbf24',
              }}>
              {copied ? '✓ Copied!' : '📋 Copy'}
            </button>
          </div>
        </div>

        {/* Name input */}
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onPlay(); }}
          placeholder="Your name"
          maxLength={16}
          className="w-full rounded-xl bg-white/10 border border-white/20 text-white placeholder-white/35
                     px-4 py-3 text-center text-lg outline-none focus:border-amber-400 transition-colors mb-3"
        />

        {/* Play */}
        <button onClick={onPlay}
          className="w-full rounded-xl font-bold text-lg py-3 transition-colors mb-3"
          style={{ background: 'rgba(245,158,11,0.9)', color: '#1a0a00' }}>
          ⚔️ Enter Party
        </button>

        <button onClick={onLeave}
          className="w-full text-center text-white/35 hover:text-white/65 text-sm transition-colors">
          ← Leave Party / Play Publicly
        </button>
      </div>
    </div>
  );
}

// ── Main Home component ───────────────────────────────────────────────────────

function Home() {
  const [name,      setName]      = useState('');
  const [screen,    setScreen]    = useState<Screen>('home');
  const [lobbyCode, setLobbyCode] = useState<string | null>(null);

  // On mount: read ?lobby=CODE from URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code   = params.get('lobby')?.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 10);
    if (code && code.length >= 4) {
      setLobbyCode(code);
      setScreen('lobby');
      // Normalise the URL so it shows the canonical code
      window.history.replaceState({}, '', `?lobby=${code}`);
    }
  }, []);

  function activeName() {
    return name.trim().slice(0, 16) || 'Blob';
  }

  function handlePlayPublic() {
    setLobbyCode(null);
    // Clear any lobby param from URL
    window.history.replaceState({}, '', window.location.pathname);
    setScreen('playing');
  }

  async function handleCreateParty() {
    const code = await createLobby();
    setLobbyCode(code);
    window.history.pushState({}, '', `?lobby=${code}`);
    setScreen('lobby');
  }

  function handleJoinByCode(code: string) {
    setLobbyCode(code);
    window.history.pushState({}, '', `?lobby=${code}`);
    setScreen('lobby');
  }

  function handlePlay() {
    setScreen('playing');
  }

  function handleExit() {
    // Return to lobby screen if was in a private party, else home
    setScreen(lobbyCode ? 'lobby' : 'home');
  }

  function handleLeaveParty() {
    setLobbyCode(null);
    window.history.pushState({}, '', window.location.pathname);
    setScreen('home');
  }

  if (screen === 'playing') {
    return (
      <GameCanvas
        name={activeName()}
        lobbyCode={lobbyCode}
        onExit={handleExit}
      />
    );
  }

  if (screen === 'lobby' && lobbyCode) {
    return (
      <LobbyScreen
        lobbyCode={lobbyCode}
        name={name}
        setName={setName}
        onPlay={handlePlay}
        onLeave={handleLeaveParty}
      />
    );
  }

  if (screen === 'join') {
    return (
      <JoinScreen
        onJoin={handleJoinByCode}
        onBack={() => setScreen('home')}
      />
    );
  }

  return (
    <HomeScreen
      name={name}
      setName={setName}
      onPlayPublic={handlePlayPublic}
      onCreateParty={handleCreateParty}
      onJoinCode={() => setScreen('join')}
    />
  );
}

// ── Router ────────────────────────────────────────────────────────────────────

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
