import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { useState } from 'react';
import GameCanvas from '@/game/GameCanvas';

const queryClient = new QueryClient();

function Home() {
  const [name, setName] = useState('');
  const [playing, setPlaying] = useState(false);
  const [activeName, setActiveName] = useState('');

  if (playing) {
    return (
      <GameCanvas name={activeName} onExit={() => setPlaying(false)} />
    );
  }

  function handleStart() {
    const trimmed = name.trim().slice(0, 16);
    setActiveName(trimmed || 'Blob');
    setPlaying(true);
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-[#0d2417] via-[#173820] to-[#245c33] px-4">
      <div className="w-full max-w-sm bg-black/30 backdrop-blur-md border border-white/10 rounded-3xl p-8 shadow-2xl">
        <h1 className="text-4xl font-extrabold text-white text-center tracking-tight">
          ChopBlob<span className="text-amber-400">.io</span>
        </h1>
        <p className="text-white/60 text-center text-sm mt-2 mb-8">
          Roam the forest, buy a sword, chop trees, collect coins.
        </p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleStart();
          }}
          placeholder="Enter your name"
          maxLength={16}
          className="w-full rounded-xl bg-white/10 border border-white/20 text-white placeholder-white/40 px-4 py-3 text-center text-lg outline-none focus:border-amber-400 transition-colors"
        />
        <button
          onClick={handleStart}
          className="mt-4 w-full rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold text-lg py-3 transition-colors"
        >
          Play
        </button>
        <p className="text-white/40 text-center text-xs mt-6">
          Move with your mouse, WASD, or arrow keys (joystick on mobile) ·
          Buy a sword for 1 coin · Chop trees for +1 coin
        </p>
      </div>
    </div>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
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

export default App;
