"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, use } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { CURRENCY_CODES, USD_BUDGET_MAX, USD_BUDGET_MIN, convertCurrency } from "@/lib/types";
import type { Currency, TripOptions } from "@/lib/types";

const CLIENT_TIMEOUT_MS = 100000;

type GenerationError = { message: string; retryable: boolean };

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
  const [error, setError] = useState<GenerationError | null>(null);
  const [status, setStatus] = useState<"loading" | "ready">("loading");
  const abortControllerRef = useRef<AbortController | null>(null);

  const rawDestination = (params.destination || "").trim();
  const destination = rawDestination || "your destination";
  const origin = (params.origin || "").trim();
  const budgetNum = Number(params.budget);
  const budget = Number.isFinite(budgetNum) ? Math.round(budgetNum) : 1000;
  const daysNum = Number(params.days);
  const days = Number.isFinite(daysNum) ? Math.round(daysNum) : 3;
  const currency: Currency = (CURRENCY_CODES as readonly string[]).includes(params.currency ?? "") ? (params.currency as Currency) : "USD";
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

  const budgetUSD = Number.isFinite(budgetNum) ? convertCurrency(Math.round(budgetNum), currency, "USD") : NaN;
  const paramError = !rawDestination || rawDestination.length < 2
    ? "Please enter a destination (at least 2 characters)."
    : rawDestination.length > 120
      ? "Destination is too long (max 120 characters)."
      : !Number.isFinite(budgetUSD) || budgetUSD < USD_BUDGET_MIN || budgetUSD > USD_BUDGET_MAX
        ? `Budget must equal USD ${USD_BUDGET_MIN}–${USD_BUDGET_MAX.toLocaleString("en-US")} in value.`
        : !Number.isFinite(daysNum) || days < 1 || days > 14
          ? "Trip length must be between 1 and 14 days."
          : null;

  useEffect(() => {
    if (authLoading || error || status === "ready") return;
    const interval = setInterval(() => {
      setStageIndex((prev) => {
        if (prev < STAGES.length - 1) return prev + 1;
        clearInterval(interval);
        return prev;
      });
    }, 800);

    return () => clearInterval(interval);
  }, [authLoading, error, status]);

  const startTimeRef = useRef<number>(0);
  const generateItinerary = useCallback(async () => {
    if (paramError) {
      setError({ message: paramError, retryable: false });
      return;
    }
    if (abortControllerRef.current) return;
    setError(null);
    setStatus("loading");
    setStageIndex(0);
    startTimeRef.current = Date.now();

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const clientTimer = setTimeout(() => controller.abort(new DOMException("Generation timed out.", "TimeoutError")), CLIENT_TIMEOUT_MS);

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
      controller.signal.throwIfAborted();
      if (!res.ok) {
        const failure = data as { error?: string; retryable?: boolean; code?: string } | null;
        const retryable = failure?.code !== "not_configured" && failure?.code !== "provider_configuration"
          && (failure?.retryable ?? (res.status >= 500 || res.status === 429));
        setError({ message: failure?.error || `Generation failed (HTTP ${res.status}).`, retryable });
        return;
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
      // Success: show a distinct "ready" state briefly so the transition into
      // the itinerary is legible instead of an unexplained jump.
      setStatus("ready");
      await new Promise((resolve) => setTimeout(resolve, 450));
      controller.signal.throwIfAborted();
      router.push(`/trip/${tripId}`);
    } catch (err) {
      if (abortControllerRef.current !== controller) return;
      const message = controller.signal.aborted
        ? "Generation timed out. Please retry."
        : err instanceof Error ? err.message : "Something went wrong.";
      setError({ message, retryable: true });
    } finally {
      clearTimeout(clientTimer);
      if (abortControllerRef.current === controller) abortControllerRef.current = null;
    }
  }, [paramError, rawDestination, origin, budget, days, currency, options, router, user]);

  useEffect(() => {
    if (authLoading) return;
    const start = setTimeout(() => void generateItinerary(), 0);

    return () => {
      clearTimeout(start);
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    };
  }, [authLoading, generateItinerary]);

  const handleEditTrip = () => {
    const params = new URLSearchParams(searchParamsClient);
    router.push(`/?${params.toString()}`);
  };

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-deep px-4">
        <div className="text-center max-w-md" role="alert" aria-live="assertive">
          <p className="font-mono text-xs text-gold-brass uppercase tracking-widest mb-3">
            No itinerary generated
          </p>
          <h2 className="font-display text-2xl sm:text-3xl font-bold text-sand-light mb-4">
            We couldn&apos;t chart this trip
          </h2>
          <p className="font-body text-sm text-coral-warm mb-3">{error.message}</p>
          <p className="font-mono text-xs text-sand-light/60 mb-6">
            {error.retryable ? "Retry this trip or edit your details." : "You can return to the form with your trip details filled in."}
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            {error.retryable ? (
              <button
                onClick={() => void generateItinerary()}
                className="font-mono text-sm px-6 py-3 bg-gold-brass text-bg-deep rounded-lg hover:bg-gold-brass/90 transition-colors focus:outline-none focus:ring-2 focus:ring-gold-brass focus:ring-offset-2 focus:ring-offset-bg-deep"
              >
                Retry
              </button>
            ) : null}
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

  const isReady = status === "ready";
  const currentMessage = isReady
    ? "Your itinerary is ready — opening your plan..."
    : STAGES[Math.min(stageIndex, STAGES.length - 1)].replace("{destination}", destination);

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-deep px-4">
      <div className="text-center max-w-md">
        <div className="mb-8">
          {isReady ? (
            <div
              className="w-16 h-16 rounded-full border-2 border-gold-brass flex items-center justify-center mx-auto mb-6"
              role="status"
              aria-label="Itinerary ready"
            >
              <span className="w-4 h-4 rounded-full bg-gold-brass" aria-hidden="true" />
            </div>
          ) : (
            <div
              className="w-16 h-16 border-2 border-gold-brass border-t-transparent rounded-full animate-spin mx-auto mb-6"
              role="status"
              aria-label="Generating itinerary"
            />
          )}
          <h2 className="font-display text-3xl font-bold text-sand-light mb-4">
            {isReady ? "Course charted" : "Charting your course"}
          </h2>
          <p className="font-mono text-sm text-sand-light/70" aria-live="polite">
            {currentMessage}
          </p>
        </div>
        <div className="flex justify-center gap-2" aria-label="Generation progress">
          {STAGES.map((_, i) => (
            <div
              key={i}
              className={`h-1 rounded-full transition-all duration-500 ${
                isReady || i <= stageIndex ? "w-8 bg-gold-brass" : "w-4 bg-sand-light/20"
              }`}
            ></div>
          ))}
        </div>
      </div>
    </div>
  );
}
