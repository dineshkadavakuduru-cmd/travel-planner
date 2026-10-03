"use client";

import { Suspense, useEffect, useRef, useState, use } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";

const STAGES = [
  "Finding the best spots in {destination}...",
  "Matching food to your budget...",
  "Building your day-by-day...",
  "Finalizing your itinerary...",
];

export default function PlanLoadingPage({
  searchParams,
}: {
  searchParams: Promise<{ destination?: string; origin?: string; budget?: string; days?: string }>;
}) {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-bg-deep">
          <div className="w-16 h-16 border-2 border-gold-brass border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      }
    >
      <PlanLoadingInner searchParams={searchParams} />
    </Suspense>
  );
}

function PlanLoadingInner({
  searchParams,
}: {
  searchParams: Promise<{ destination?: string; origin?: string; budget?: string; days?: string }>;
}) {
  const params = use(searchParams);
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [stageIndex, setStageIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const hasGeneratedRef = useRef(false);

  const destination = params.destination || "your destination";
  const origin = params.origin || "";
  const budget = Number(params.budget) || 1000;
  const days = Math.min(14, Math.max(1, Number(params.days) || 3));

  useEffect(() => {
    const stageMessages = STAGES.map((s) => s.replace("{destination}", destination));
    const interval = setInterval(() => {
      setStageIndex((prev) => {
        if (prev < stageMessages.length - 1) return prev + 1;
        clearInterval(interval);
        return prev;
      });
    }, 800);

    return () => clearInterval(interval);
  }, [destination]);

  useEffect(() => {
    if (authLoading || hasGeneratedRef.current) return;

    async function generateItinerary() {
      hasGeneratedRef.current = true;
      try {
        const token = user ? await user.getIdToken() : null;
        const res = await fetch("/api/generate", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            destination,
            origin,
            budget,
            days,
          }),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to generate itinerary");
        }

        const trip = await res.json();
        // The API now returns the full trip object with originAirportOrCity, etc.
        let tripId: string;
        if (user) {
          const token = await user.getIdToken();
          const saveRes = await fetch("/api/trips", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ tripData: trip }),
          });
          if (!saveRes.ok) throw new Error("Your itinerary was generated but could not be saved.");
          tripId = (await saveRes.json()).tripId;
        } else {
          tripId = `local_${Date.now()}`;
          localStorage.setItem(`trip_${tripId}`, JSON.stringify({ ...trip, id: tripId }));
        }
        router.push(`/trip/${tripId}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      }
    }

    generateItinerary();
  }, [authLoading, destination, origin, budget, days, router, user]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-deep">
        <div className="text-center">
          <p className="font-display text-2xl text-coral-warm mb-4">{error}</p>
          <button
            onClick={() => router.push("/")}
            className="font-body text-gold-brass hover:underline"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  const currentMessage = STAGES[Math.min(stageIndex, STAGES.length - 1)].replace(
    "{destination}",
    destination
  );

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-deep">
      <div className="text-center max-w-md px-4">
        <div className="mb-8">
          <div className="w-16 h-16 border-2 border-gold-brass border-t-transparent rounded-full animate-spin mx-auto mb-6"></div>
          <h2 className="font-display text-3xl font-bold text-sand-light mb-4">
            Charting your course
          </h2>
          <p className="font-mono text-sm text-sand-light/70">
            {currentMessage}
          </p>
        </div>
        <div className="flex justify-center gap-2">
          {STAGES.map((_, i) => (
            <div
              key={i}
              className={`h-1 rounded-full transition-all duration-500 ${
                i <= stageIndex ? "w-8 bg-gold-brass" : "w-4 bg-sand-light/20"
              }`}
            ></div>
          ))}
        </div>
      </div>
    </div>
  );
}
