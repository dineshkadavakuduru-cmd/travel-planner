"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { formatCurrency, migrateTrip, resolveCurrency } from "@/lib/types";
import type { Trip } from "@/lib/types";

const UNDO_WINDOW_MS = 5000;

export default function MyTripsPage() {
  const { user, loading: authLoading } = useAuth();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ trip: Trip; index: number } | null>(null);

  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoTargetRef = useRef<{ trip: Trip; index: number } | null>(null);

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
        const raw = (await response.json()) as unknown[];
        // Defensively migrate every row so a single legacy/corrupt trip cannot
        // blank the whole list.
        const list = (Array.isArray(raw) ? raw : [])
          .map((t) => migrateTrip(t))
          .filter((t): t is Trip => t !== null);
        if (!cancelled) setTrips(list);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load trips");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadTrips();
    return () => { cancelled = true; };
  }, [user, authLoading]);

  const commitDelete = useCallback(async (tripId: string, restore?: { trip: Trip; index: number }) => {
    try {
      const current = user;
      if (!current) throw new Error("Sign in to delete trips");
      const token = await current.getIdToken();
      if (!token) throw new Error("Sign in to delete trips");
      const response = await fetch(`/api/trips?tripId=${encodeURIComponent(tripId)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error((await response.json()).error || "Failed to delete trip");
      setNotice("Trip deleted.");
    } catch (err) {
      if (restore) {
        setTrips((current) => {
          const next = [...current];
          next.splice(Math.min(restore.index, next.length), 0, restore.trip);
          return next;
        });
      }
      setNotice(err instanceof Error ? err.message : "Failed to delete trip");
    }
  }, [user]);

  const flushPendingUndo = useCallback(() => {
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    const pending = undoTargetRef.current;
    undoTargetRef.current = null;
    if (pending) void commitDelete(pending.trip.id, pending);
    setUndo(null);
  }, [commitDelete]);

  const confirmDelete = useCallback((trip: Trip) => {
    setConfirmingId(null);
    // Commit any earlier pending deletion before starting a new one.
    flushPendingUndo();

    const index = Math.max(0, trips.findIndex((t) => t.id === trip.id));
    setTrips((current) => current.filter((t) => t.id !== trip.id));
    const target = { trip, index };
    undoTargetRef.current = target;
    setUndo(target);
    setNotice(null);

    undoTimerRef.current = setTimeout(() => {
      undoTimerRef.current = null;
      const pending = undoTargetRef.current;
      undoTargetRef.current = null;
      setUndo(null);
      if (pending) void commitDelete(pending.trip.id, pending);
    }, UNDO_WINDOW_MS);
  }, [trips, commitDelete, flushPendingUndo]);

  const undoDelete = useCallback(() => {
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    const pending = undoTargetRef.current;
    undoTargetRef.current = null;
    setUndo(null);
    if (!pending) return;
    setTrips((current) => {
      const next = [...current];
      next.splice(Math.min(pending.index, next.length), 0, pending.trip);
      return next;
    });
    setNotice("Deletion undone.");
  }, []);

  // Leaving the page within the undo window must still delete the trip.
  useEffect(() => () => {
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
      const pending = undoTargetRef.current;
      undoTargetRef.current = null;
      if (pending) void commitDelete(pending.trip.id, pending);
    }
  }, [commitDelete]);

  return (
    <div className="min-h-screen bg-bg-deep">
      <div className="border-b border-sand-light/10 bg-bg-surface/50 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="font-display text-xl sm:text-2xl font-bold text-sand-light">My <span className="italic text-gold-brass">Trips</span></h1>
            <p className="font-mono text-xs text-sand-light/60 mt-1">{trips.length} SAVED DEPARTURES</p>
          </div>
          <Link href="/" className="font-mono text-xs px-4 py-2 border border-gold-brass/40 text-gold-brass rounded-lg hover:bg-gold-brass/10 transition-colors focus:outline-none focus:ring-2 focus:ring-gold-brass whitespace-nowrap">Plan New Trip</Link>
        </div>
      </div>
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        {notice && <div role="status" className="mb-4 font-mono text-xs text-gold-brass">{notice}</div>}
        {undo ? (
          <div role="status" className="mb-4 flex items-center justify-between gap-4 rounded-lg border border-gold-brass/30 bg-bg-surface px-4 py-3">
            <span className="font-mono text-xs text-sand-light/80">Deleted &ldquo;{undo.trip.destination}&rdquo;.</span>
            <button
              type="button"
              onClick={undoDelete}
              className="font-mono text-xs px-3 py-1.5 border border-gold-brass/40 text-gold-brass rounded-lg hover:bg-gold-brass/10 transition-colors focus:outline-none focus:ring-2 focus:ring-gold-brass"
            >
              Undo
            </button>
          </div>
        ) : null}

        {authLoading || (user && loading) ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map((item) => <div key={item} className="h-64 rounded-2xl bg-bg-surface animate-pulse" />)}
          </div>
        ) : error ? (
          <div className="text-center py-20">
            <p className="font-display text-xl text-coral-warm mb-4">{error}</p>
            <Link href="/" className="font-body text-gold-brass hover:underline">Back to home</Link>
          </div>
        ) : !user ? (
          <div className="text-center py-20">
            <p className="font-display text-xl text-sand-light/70 mb-4">Sign in to see saved trips</p>
            <Link href="/" className="font-body text-gold-brass hover:underline">Plan your first trip</Link>
          </div>
        ) : trips.length === 0 ? (
          <div className="text-center py-20">
            <div className="mx-auto mb-6 w-16 h-16 rounded-full border border-gold-brass/40 flex items-center justify-center font-display text-2xl text-gold-brass" aria-hidden="true">✈</div>
            <p className="font-display text-xl text-sand-light/70 mb-2">No trips saved yet</p>
            <p className="font-body text-sm text-sand-light/60 mb-4">Your saved itineraries will appear here (latest 50).</p>
            <Link href="/" className="font-body text-gold-brass hover:underline">Plan your first trip</Link>
          </div>
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 list-none p-0">
            {trips.map((trip) => (
              <li key={trip.id} className="group bg-bg-surface border border-sand-light/10 rounded-2xl overflow-hidden hover:border-gold-brass/40 transition-all duration-300 flex flex-col">
                <Link href={`/trip/${trip.id}`} className="block focus:outline-none focus:ring-2 focus:ring-gold-brass">
                  <div className="h-40 bg-gradient-to-br from-gold-brass/20 to-coral-warm/20 relative">
                    <div className="absolute inset-0 flex items-center justify-center px-4">
                      <span className="font-display text-2xl font-bold text-sand-light/80 group-hover:text-gold-brass transition-colors text-center break-words">
                        {trip.destination}
                      </span>
                    </div>
                  </div>
                  <div className="p-5">
                    <div className="flex justify-between items-center gap-3 mb-3">
                      <span className="font-mono text-xs text-sand-light/60 uppercase tracking-wider">{trip.days.length} Days</span>
                      <span className="font-mono text-sm text-gold-brass">{formatCurrency(trip.budget, resolveCurrency(trip.currency))}</span>
                    </div>
                    <div className="h-px bg-sand-light/10 mb-3" />
                    <span className="font-mono text-xs text-sand-light/60">
                      {new Date(trip.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}
                    </span>
                  </div>
                </Link>
                <div className="px-5 pb-4 mt-auto flex justify-end">
                  {confirmingId === trip.id ? (
                    <div className="flex items-center gap-3" role="group" aria-label={`Confirm deletion of ${trip.destination}`}>
                      <span className="font-mono text-xs text-sand-light/80">Delete?</span>
                      <button
                        type="button"
                        onClick={() => confirmDelete(trip)}
                        className="font-mono text-xs px-3 py-1.5 rounded-lg border border-coral-warm/60 text-coral-warm hover:bg-coral-warm/10 transition-colors focus:outline-none focus:ring-2 focus:ring-coral-warm"
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingId(null)}
                        className="font-mono text-xs px-3 py-1.5 rounded-lg border border-sand-light/20 text-sand-light/80 hover:border-gold-brass/40 transition-colors focus:outline-none focus:ring-2 focus:ring-gold-brass"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmingId(trip.id)}
                      aria-label={`Delete ${trip.destination}`}
                      className="font-mono text-xs px-3 py-1.5 rounded-lg border border-transparent text-coral-warm hover:border-coral-warm/60 hover:bg-coral-warm/10 transition-colors focus:outline-none focus:ring-2 focus:ring-coral-warm"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
