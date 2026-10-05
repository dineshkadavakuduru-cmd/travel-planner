"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, use } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import type { TripOptions } from "@/lib/types";

const CLIENT_TIMEOUT_MS = 95000;

const STAGES = [
  "Finding the best spots in {destination}...",
  "Matching food to your budget...",
  "Building your day-by-day...",
  "Finalizing your itinerary...",
];

export default function PlanLoadingPage({
  searchParams,
}: {
  searchParams: Promise<{ destination?: string; origin?: string; budget?: string; days?: string; currency?: string; travelers?: string; accommodationLevel?: string; travelStyle?: string; transportPreference?: string; travelDatesStart?: string; travelDatesEnd?: string }>;
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
  searchParams: Promise<{ destination?: string; origin?: string; budget?: string; days?: string; currency?: string; travelers?: string; accommodationLevel?: string; travelStyle?: string; transportPreference?: string; travelDatesStart?: string; travelDatesEnd?: string }>;
}) {
  const params = use(searchParams);
  const router = useRouter();
  const searchParamsClient = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const [stageIndex, setStageIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const hasGeneratedRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const rawDestination = (params.destination || "").trim();
  const destination = rawDestination || "your destination";
  const origin = (params.origin || "").trim();
  const budgetNum = Number(params.budget);
  const budget = Number.isFinite(budgetNum) ? Math.round(budgetNum) : 1000;
  const daysNum = Number(params.days);
  const days = Number.isFinite(daysNum) ? Math.round(daysNum) : 3;
  const currency = (["USD", "INR", "EUR", "GBP"] as const).includes(params.currency as "USD") ? (params.currency as "USD" | "INR" | "EUR" | "GBP") : "USD";
  const travelersNum = Number(params.travelers);
  const travelers = Number.isFinite(travelersNum) ? Math.min(20, Math.max(1, Math.round(travelersNum))) : 1;
  const accommodationLevel = (["budget", "mid", "luxury"] as const).includes(params.accommodationLevel as "mid") ? (params.accommodationLevel as "budget" | "mid" | "luxury") : "mid";
  const travelStyle = (["relaxed", "balanced", "packed"] as const).includes(params.travelStyle as "balanced") ? (params.travelStyle as "relaxed" | "balanced" | "packed") : "balanced";
  const transportPreference = (["public", "mixed", "private"] as const).includes(params.transportPreference as "mixed") ? (params.transportPreference as "public" | "mixed" | "private") : "mixed";
  const travelDatesStart = params.travelDatesStart || "";
  const travelDatesEnd = params.travelDatesEnd || "";
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  const validDates = dateRe.test(travelDatesStart) && dateRe.test(travelDatesEnd) && travelDatesStart <= travelDatesEnd;

  const options: TripOptions = useMemo(() => ({
    travelers,
    accommodationLevel,
    travelStyle,
    transportPreference,
    travelDates: validDates ? { start: travelDatesStart, end: travelDatesEnd } : undefined,
  }), [travelers, accommodationLevel, travelStyle, transportPreference, travelDatesStart, travelDatesEnd, validDates]);

  const paramError = !rawDestination || rawDestination.length < 2
    ? "Please enter a destination (at least 2 characters)."
    : rawDestination.length > 120
      ? "Destination is too long (max 120 characters)."
      : !Number.isFinite(budgetNum) || budget < 200 || budget > 100000
        ? "Budget must be between 200 and 100,000."
        : !Number.isFinite(daysNum) || days < 1 || days > 14
          ? "Trip length must be between 1 and 14 days."
          : null;

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

  const startTimeRef = useRef<number>(0);
  const generateItinerary = useCallback(async (isRetry = false) => {
    if (paramError) { setError(paramError); return; }
    if (hasGeneratedRef.current && !isRetry) return;
    hasGeneratedRef.current = true;
    setError(null);
    setIsRetrying(true);
    startTimeRef.current = Date.now();

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const clientTimer = setTimeout(() => controller.abort(new Error("Generation timed out. Please retry.")), CLIENT_TIMEOUT_MS);

    try {
      const token = user ? await user.getIdToken() : null;
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          destination: rawDestination,
          origin,
          budget,
          days,
          currency,
          options,
        }),
        signal: controller.signal,
      });

      let data: unknown = null;
      try { data = await res.json(); } catch { data = null; }
      if (!res.ok) {
        const msg = (data as { error?: string } | null)?.error || `Generation failed (HTTP ${res.status}). Please retry.`;
        throw new Error(msg);
      }

      const trip = data as Record<string, unknown>;
      if (!trip || !Array.isArray((trip as { days?: unknown }).days)) {
        throw new Error("The itinerary response was empty. Please retry.");
      }
      const latencyMs = Date.now() - startTimeRef.current;
      try { sessionStorage.setItem("lastGenerationLatencyMs", String(latencyMs)); } catch { /* ignore */ }
      console.info(`Itinerary generated in ${latencyMs}ms`);

      let tripId: string;
      if (user) {
        const saveToken = await user.getIdToken();
        const saveRes = await fetch("/api/trips", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${saveToken}` },
          body: JSON.stringify({ tripData: trip }),
          signal: controller.signal,
        });
        if (!saveRes.ok) throw new Error("Your itinerary was generated but could not be saved.");
        tripId = (await saveRes.json()).tripId;
      } else {
        tripId = `local_${Date.now()}`;
        try {
          localStorage.setItem(`trip_${tripId}`, JSON.stringify({ ...trip, id: tripId }));
        } catch {
          throw new Error("Generated, but browser storage is full. Sign in to save instead.");
        }
      }
      router.push(`/trip/${tripId}`);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setError("Generation timed out. Please retry.");
        return;
      }
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      clearTimeout(clientTimer);
      setIsRetrying(false);
    }
  }, [paramError, rawDestination, origin, budget, days, currency, options, router, user]);

  useEffect(() => {
    if (authLoading) return;
    // Kick off generation once auth resolves; state updates happen in async callbacks below.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void generateItinerary();

    return () => {
      abortControllerRef.current?.abort();
    };
  }, [authLoading, generateItinerary]);

  const handleRetry = () => generateItinerary(true);

  const handleEditTrip = () => {
    const params = new URLSearchParams(searchParamsClient);
    router.push(`/?${params.toString()}`);
  };

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-deep">
        <div className="text-center max-w-md px-4" role="alert">
          <p className="font-display text-2xl text-coral-warm mb-6">{error}</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={handleRetry}
              disabled={isRetrying}
              className="font-mono text-sm px-6 py-3 bg-gold-brass text-bg-deep rounded-lg hover:bg-gold-brass/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus:outline-none focus:ring-2 focus:ring-gold-brass focus:ring-offset-2 focus:ring-offset-bg-deep"
            >
              {isRetrying ? "Retrying..." : "Retry"}
            </button>
            <button
              onClick={handleEditTrip}
              className="font-mono text-sm px-6 py-3 border border-gold-brass/40 text-gold-brass rounded-lg hover:bg-gold-brass/10 transition-colors focus:outline-none focus:ring-2 focus:ring-gold-brass focus:ring-offset-2 focus:ring-offset-bg-deep"
            >
              Edit Trip
            </button>
          </div>
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
          <div className="w-16 h-16 border-2 border-gold-brass border-t-transparent rounded-full animate-spin mx-auto mb-6" role="status" aria-label="Generating itinerary"></div>
          <h2 className="font-display text-3xl font-bold text-sand-light mb-4">
            Charting your course
          </h2>
          <p className="font-mono text-sm text-sand-light/70">
            {currentMessage}
          </p>
        </div>
        <div className="flex justify-center gap-2" aria-label="Generation progress">
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
