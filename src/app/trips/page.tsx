"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { formatCurrency, resolveCurrency } from "@/lib/types";
import type { Trip } from "@/lib/types";

export default function MyTripsPage() {
  const { user, loading: authLoading } = useAuth();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    const currentUser = user;
    if (!currentUser) return;
    let cancelled = false;
    async function loadTrips() {
      if (!currentUser) return;
      try {
        const token = await currentUser.getIdToken();
        if (!token) throw new Error("Sign in to view your trips");
        const response = await fetch(`/api/trips?userId=${encodeURIComponent(currentUser.uid)}`, { headers: { Authorization: `Bearer ${token}` } });
        if (!response.ok) throw new Error((await response.json()).error || "Failed to load trips");
        if (!cancelled) setTrips((await response.json()) as Trip[]);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load trips");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadTrips();
    return () => { cancelled = true; };
  }, [user, authLoading]);

  const deleteTrip = async (tripId: string) => {
    if (!window.confirm("Delete this trip? This cannot be undone.")) return;
    const previous = trips;
    // Optimistic update with rollback on failure.
    setTrips((current) => current.filter((trip) => trip.id !== tripId));
    try {
      const current = user;
      if (!current) throw new Error("Sign in to delete trips");
      const token = await current.getIdToken();
      if (!token) throw new Error("Sign in to delete trips");
      const response = await fetch(`/api/trips?tripId=${encodeURIComponent(tripId)}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error((await response.json()).error || "Failed to delete trip");
      setNotice("Trip deleted.");
    } catch (err) {
      setTrips(previous);
      setNotice(err instanceof Error ? err.message : "Failed to delete trip");
    }
  };

  return (
    <div className="min-h-screen bg-bg-deep">
      <div className="border-b border-sand-light/10 bg-bg-surface/50 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div>
            <h1 className="font-display text-xl sm:text-2xl font-bold text-sand-light">My <span className="italic text-gold-brass">Trips</span></h1>
            <p className="font-mono text-xs text-sand-light/50 mt-1">{trips.length} SAVED DEPARTURES</p>
          </div>
          <Link href="/" className="font-mono text-xs px-4 py-2 border border-gold-brass/40 text-gold-brass rounded-lg hover:bg-gold-brass/10 transition-colors">Plan New Trip</Link>
        </div>
      </div>
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        {notice && <div role="status" className="mb-4 font-mono text-xs text-gold-brass">{notice}</div>}
        {authLoading || (user && loading) ? <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">{[1, 2, 3].map((item) => <div key={item} className="h-64 rounded-2xl bg-bg-surface animate-pulse" />)}</div> : error ? <div className="text-center py-20"><p className="font-display text-xl text-coral-warm mb-4">{error}</p><Link href="/" className="font-body text-gold-brass hover:underline">Back to home</Link></div> : !user ? <div className="text-center py-20"><p className="font-display text-xl text-sand-light/70 mb-4">Sign in to see saved trips</p><Link href="/" className="font-body text-gold-brass hover:underline">Plan your first trip</Link></div> : trips.length === 0 ? <div className="text-center py-20"><div className="mx-auto mb-6 w-16 h-16 rounded-full border border-gold-brass/40 flex items-center justify-center font-display text-2xl text-gold-brass" aria-hidden="true">✈</div><p className="font-display text-xl text-sand-light/70 mb-2">No trips saved yet</p><p className="font-body text-sm text-sand-light/50 mb-4">Your saved itineraries will appear here (latest 50).</p><Link href="/" className="font-body text-gold-brass hover:underline">Plan your first trip</Link></div> : <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">{trips.map((trip) => <div key={trip.id} className="group bg-bg-surface border border-sand-light/10 rounded-2xl overflow-hidden hover:border-gold-brass/40 transition-all duration-300"><Link href={`/trip/${trip.id}`} className="block"><div className="h-40 bg-gradient-to-br from-gold-brass/20 to-coral-warm/20 relative"><div className="absolute inset-0 flex items-center justify-center"><span className="font-display text-2xl font-bold text-sand-light/80 group-hover:text-gold-brass transition-colors">{trip.destination}</span></div></div><div className="p-5"><div className="flex justify-between items-center mb-3"><span className="font-mono text-xs text-sand-light/50 uppercase tracking-wider">{trip.days.length} Days</span><span className="font-mono text-sm text-gold-brass">{formatCurrency(trip.budget, resolveCurrency(trip.currency))}</span></div><div className="h-px bg-sand-light/10 mb-3" /><span className="font-mono text-xs text-sand-light/40">{new Date(trip.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span></div></Link><div className="px-5 pb-4 flex justify-end"><button type="button" onClick={() => void deleteTrip(trip.id)} className="font-mono text-xs text-coral-warm/70 hover:text-coral-warm">Delete</button></div></div>)}</div>}
      </main>
    </div>
  );
}
