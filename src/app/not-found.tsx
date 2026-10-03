import Link from "next/link";

export default function NotFound() {
  return <main className="min-h-screen bg-bg-deep flex items-center justify-center px-6"><div className="text-center"><p className="font-mono text-xs text-gold-brass tracking-widest mb-4">404 / OFF THE MAP</p><h1 className="font-display text-5xl text-sand-light mb-4">That route disappeared.</h1><Link href="/" className="font-mono text-sm text-gold-brass hover:underline">Return to the departure board</Link></div></main>;
}
