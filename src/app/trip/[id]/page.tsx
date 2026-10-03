"use client";

import { Suspense, use, useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import type { DayPlan, FoodPick, Spot, Trip } from "@/lib/types";

gsap.registerPlugin(ScrollTrigger);

function DayMap({
  spots,
  food,
}: {
  spots: Spot[];
  food: FoodPick[];
}) {
  const [mapImageUrl, setMapImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchStaticMap() {
      const allPoints = [
        ...spots.filter((s) => s.lat && s.lng).map((s) => ({ name: s.name, lat: s.lat!, lng: s.lng! })),
        ...food.filter((f) => f.lat && f.lng).map((f) => ({ name: f.name, lat: f.lat!, lng: f.lng! })),
      ];

      if (allPoints.length === 0) {
        if (!cancelled) {
          setLoading(false);
          setError("No location data available for this day");
        }
        return;
      }

      try {
        const response = await fetch("/api/static-map", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ spots: allPoints.slice(0, 10), food: allPoints.slice(10) }),
        });

        const data = await response.json();

        if (!cancelled) {
          if (data.url) {
            setMapImageUrl(data.url);
          } else {
            setError(data.error || "Failed to load map");
          }
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError("Failed to load map");
          setLoading(false);
        }
      }
    }

    fetchStaticMap();

    return () => {
      cancelled = true;
    };
  }, [spots, food]);

  if (loading) {
    return (
      <div className="w-full h-64 sm:h-80 rounded-lg overflow-hidden bg-bg-surface flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-gold-brass border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (error || !mapImageUrl) {
    return (
      <div className="w-full h-64 sm:h-80 rounded-lg overflow-hidden bg-bg-surface flex items-center justify-center text-sand-light/50">
        <span className="font-mono text-sm">{error || "Map unavailable"}</span>
      </div>
    );
  }

  return (
    <figure className="w-full rounded-lg overflow-hidden">
      <img
        src={mapImageUrl}
        alt={`Static map showing ${spots.length} stops and ${food.length} food locations for the day`}
        className="w-full h-64 sm:h-80 rounded-lg object-cover"
        loading="lazy"
      />
      <figcaption className="sr-only">
        Map markers correspond to the stops and food picks listed in text above.
      </figcaption>
    </figure>
  );
}

function BoardingPassCard({ day, trip }: { day: DayPlan; trip: Trip }) {
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!cardRef.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      if (cardRef.current) cardRef.current.style.opacity = "1";
      return;
    }
    const ctx = gsap.context(() => {
      gsap.fromTo(
        cardRef.current,
        { opacity: 0, y: 60 },
        {
          opacity: 1,
          y: 0,
          duration: 0.8,
          ease: "power3.out",
          scrollTrigger: {
            trigger: cardRef.current,
            start: "top 80%",
            toggleActions: "play none none none",
          },
        }
      );
    }, cardRef);
    return () => ctx.revert();
  }, []);

  return (
    <div ref={cardRef} className="relative bg-bg-surface border border-sand-light/10 rounded-2xl overflow-hidden mb-8 opacity-0">
      {/* Perforated edge at top */}
      <div className="h-4 bg-bg-deep relative">
        <div className="absolute inset-x-0 top-1/2 flex justify-around">
          {Array.from({ length: 20 }).map((_, i) => (
            <div key={i} className="w-2 h-2 rounded-full bg-bg-deep border-2 border-bg-surface" />
          ))}
        </div>
      </div>

      <div className="p-6 sm:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6">
          <div>
            <span className="font-mono text-xs text-gold-brass uppercase tracking-widest">
              Day {String(day.dayNumber).padStart(2, "0")}
            </span>
            <h3 className="font-display text-2xl sm:text-3xl font-bold text-sand-light mt-1">
              {day.theme}
            </h3>
          </div>
          <div className="mt-2 sm:mt-0 flex items-center gap-4">
            <div className="text-right">
              <span className="font-mono text-xs text-sand-light/50 uppercase tracking-wider block">Budget</span>
              <span className="font-mono text-lg text-gold-brass">
                ${Math.round(trip.budget / trip.days.length)}
              </span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <h4 className="font-mono text-xs text-sand-light/50 uppercase tracking-wider mb-4">
              Stops ({day.spots.length})
            </h4>
            <div className="space-y-4">
              {day.spots.map((spot, i) => (
                <div key={i} className="flex gap-4">
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gold-brass/20 flex items-center justify-center">
                    <span className="font-mono text-sm text-gold-brass font-bold">{i + 1}</span>
                  </div>
                  <div>
                    <h5 className="font-display font-semibold text-sand-light">{spot.name}</h5>
                    <p className="font-body text-sm text-sand-light/70 mt-1">{spot.description}</p>
                    <span className="font-mono text-xs text-sand-light/40 mt-2 block">
                      ~{spot.estTimeMinutes} min
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h4 className="font-mono text-xs text-sand-light/50 uppercase tracking-wider mb-4">
              Food Picks ({day.food.length})
            </h4>
            <div className="space-y-3">
              {day.food.map((food, i) => (
                <div key={i} className="flex items-center justify-between p-3 bg-bg-deep/50 rounded-lg">
                  <div>
                    <h5 className="font-display font-semibold text-sand-light">{food.name}</h5>
                    <span className="font-mono text-xs text-sand-light/50">{food.cuisine}</span>
                  </div>
                  <span
                    className={`font-mono text-xs px-2 py-1 rounded-full ${
                      food.priceTier === "budget"
                        ? "bg-sand-light/10 text-sand-light/70"
                        : food.priceTier === "mid"
                        ? "bg-gold-brass/20 text-gold-brass"
                        : "bg-coral-warm/20 text-coral-warm"
                    }`}
                  >
                    {food.priceTier}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-6">
          <DayMap spots={day.spots} food={day.food} />
        </div>
      </div>
    </div>
  );
}

function TripDetail({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const tripId = resolvedParams.id;
  const { user, loading: authLoading } = useAuth();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const isLocalTrip = tripId.startsWith("local_");
    if (authLoading || (!isLocalTrip && !user)) return;

    let cancelled = false;
    async function loadTrip() {
      try {
        if (isLocalTrip) {
          const localTrip = localStorage.getItem(`trip_${tripId}`);
          if (!localTrip) throw new Error("Trip not found");
          if (!cancelled) setTrip(JSON.parse(localTrip) as Trip);
          return;
        }
        const token = user ? await user.getIdToken() : null;
        const response = await fetch(`/api/trips?tripId=${encodeURIComponent(tripId)}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!response.ok) throw new Error((await response.json()).error || "Trip not found");
        if (!cancelled) setTrip((await response.json()) as Trip);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Trip not found");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadTrip();
    return () => { cancelled = true; };
  }, [authLoading, tripId, user]);

  const shareTrip = async () => {
    const url = window.location.href;
    if (navigator.share) await navigator.share({ title: trip?.destination || "Travel plan", url });
    else { await navigator.clipboard.writeText(url); setNotice("Trip link copied to clipboard."); }
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-deep">
        <div className="w-8 h-8 border-2 border-gold-brass border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if ((!tripId.startsWith("local_") && !user) || error || !trip) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-deep">
        <div className="text-center">
          <p className="font-display text-2xl text-coral-warm mb-4">{error || (!user ? "Sign in to view this private trip" : "Trip not found")}</p>
          <Link href="/" className="font-body text-gold-brass hover:underline">
            Back to home
          </Link>
        </div>
      </div>
    );
  }

  const budgetUsed = trip.totalEstCost;
  const budgetRemaining = trip.budget - budgetUsed;
  const budgetUsedPercent = Math.min((budgetUsed / trip.budget) * 100, 100);

  return (
      <div className="min-h-screen bg-bg-deep">
      <div className="border-b border-sand-light/10 bg-bg-surface/50 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div>
            <h1 className="font-display text-xl sm:text-2xl font-bold text-sand-light">
              {trip.destination}
            </h1>
            <p className="font-mono text-xs text-sand-light/50 mt-1">
              {trip.days.length} DAYS · {trip.currency} ${trip.budget}
            </p>
          </div>
          <div className="flex gap-3">
            <button onClick={() => setNotice(tripId.startsWith("local_") ? "This plan is saved on this device. Sign in to sync it across devices." : "Trip is saved to your account.")} className="font-mono text-xs px-4 py-2 border border-gold-brass/40 text-gold-brass rounded-lg hover:bg-gold-brass/10 transition-colors focus:outline-none focus:ring-2 focus:ring-gold-brass">
              Save Trip
            </button>
            <button onClick={() => void shareTrip()} className="font-mono text-xs px-4 py-2 bg-gold-brass text-bg-deep rounded-lg hover:bg-gold-brass/90 transition-colors focus:outline-none focus:ring-2 focus:ring-gold-brass focus:ring-offset-2 focus:ring-offset-bg-deep">
              Share
            </button>
          </div>
        </div>
      </div>

      {notice && <div role="status" className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-4 font-mono text-xs text-gold-brass">{notice}</div>}

      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        {/* Budget Breakdown */}
        <div className="bg-bg-surface border border-sand-light/10 rounded-2xl p-6 sm:p-8 mb-8">
          <h2 className="font-display text-xl font-bold text-sand-light mb-4">Budget Breakdown</h2>
          <div className="w-full h-4 bg-bg-deep rounded-full overflow-hidden flex">
            <div className="h-full bg-gold-brass transition-all duration-1000" style={{ width: `${budgetUsedPercent}%` }}></div>
            <div
              className="h-full bg-sand-light/20 transition-all duration-1000"
              style={{ width: `${100 - budgetUsedPercent}%` }}
            ></div>
          </div>
          <div className="flex justify-between mt-4">
            <div>
              <span className="font-mono text-xs text-sand-light/50 block">Used</span>
              <span className="font-mono text-lg text-gold-brass">${budgetUsed}</span>
            </div>
            <div className="text-right">
              <span className="font-mono text-xs text-sand-light/50 block">Remaining</span>
              <span className="font-mono text-lg text-sand-light/70">${budgetRemaining}</span>
            </div>
          </div>
        </div>

        {/* Day Cards */}
        <div>
          <h2 className="font-display text-2xl font-bold text-sand-light mb-8">
            Your <span className="italic text-gold-brass">Itinerary</span>
          </h2>
          <div>
            {trip.days.map((day) => (
              <BoardingPassCard key={day.dayNumber} day={day} trip={trip} />
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

export default function TripResultPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-bg-deep">
          <div className="w-8 h-8 border-2 border-gold-brass border-t-transparent rounded-full animate-spin"></div>
        </div>
      }
    >
      <TripDetail params={params} />
    </Suspense>
  );
}
