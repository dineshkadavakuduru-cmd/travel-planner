"use client";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="min-h-screen bg-bg-deep flex items-center justify-center px-6"><div className="text-center"><p className="font-mono text-xs text-coral-warm tracking-widest mb-4">SYSTEM DELAY</p><h1 className="font-display text-4xl text-sand-light mb-4">This route hit turbulence.</h1><button onClick={reset} className="font-mono text-sm text-gold-brass hover:underline">Try again</button></div></main>;
}
