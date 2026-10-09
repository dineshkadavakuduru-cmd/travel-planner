"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import dynamic from "next/dynamic";
import ParticleLayer from "@/components/ParticleLayer";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { CURRENCIES, convertCurrency, formatCurrency, type Currency } from "@/lib/types";

const GlobeScene = dynamic(() => import("@/components/Globe"), {
  ssr: false,
  loading: () => <div className="w-full h-full bg-bg-deep" aria-hidden="true" />,
});

gsap.registerPlugin(ScrollTrigger);

const CURRENCY_LIST: Currency[] = ["USD", "INR", "EUR", "GBP"];

const POPULAR_TRIPS: Array<{
  destination: string;
  days: number;
  budgetUSD: number;
  blurb: string;
}> = [
  { destination: "Tokyo, Japan", days: 5, budgetUSD: 2000, blurb: "Neon wards, temples & day-trip to Nikko" },
  { destination: "Paris, France", days: 4, budgetUSD: 1800, blurb: "Museums, arrondissements & bistro nights" },
  { destination: "Barcelona, Spain", days: 3, budgetUSD: 900, blurb: "Gaudi, tapas & beach promenade" },
  { destination: "Bali, Indonesia", days: 7, budgetUSD: 1500, blurb: "Temples, rice terraces & island hops" },
];

function budgetBounds(currency: Currency) {
  const min = convertCurrency(200, "USD", currency);
  const max = convertCurrency(10000, "USD", currency);
  const step = currency === "INR" ? 500 : currency === "USD" ? 50 : 20;
  return { min, max, step };
}

function HomeInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const getParam = useCallback((k: string) => searchParams.get(k) ?? "", [searchParams]);

  const [destination, setDestination] = useState(() => getParam("destination"));
  const [origin, setOrigin] = useState(() => getParam("origin"));
  const [currency, setCurrency] = useState<Currency>(() => {
    const c = getParam("currency").toUpperCase();
    return (CURRENCY_LIST as string[]).includes(c) ? (c as Currency) : "USD";
  });
  const [budget, setBudget] = useState<number>(() => {
    const b = Number(getParam("budget"));
    return Number.isFinite(b) && b > 0 ? Math.round(b) : convertCurrency(1000, "USD", "USD");
  });
  const [days, setDays] = useState<number>(() => {
    const d = Number(getParam("days"));
    return Number.isFinite(d) && d >= 1 && d <= 14 ? Math.round(d) : 3;
  });
  const [travelers, setTravelers] = useState(() => Math.min(20, Math.max(1, Number(getParam("travelers")) || 1)));
  const [accommodationLevel, setAccommodationLevel] = useState<"budget" | "mid" | "luxury">(() => {
    const v = getParam("accommodationLevel");
    return v === "budget" || v === "luxury" ? v : "mid";
  });
  const [travelStyle, setTravelStyle] = useState<"relaxed" | "balanced" | "packed">(() => {
    const v = getParam("travelStyle");
    return v === "relaxed" || v === "packed" ? v : "balanced";
  });
  const [transportPreference, setTransportPreference] = useState<"public" | "mixed" | "private">(() => {
    const v = getParam("transportPreference");
    return v === "public" || v === "private" ? v : "mixed";
  });
  const [dateStart, setDateStart] = useState(() => getParam("travelDatesStart"));
  const [dateEnd, setDateEnd] = useState(() => getParam("travelDatesEnd"));

  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [geoWarning, setGeoWarning] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [globeVisible, setGlobeVisible] = useState(false);
  const [touched, setTouched] = useState(false);
  const submitGuard = useRef(false);
  const exampleTripsRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);

  const { min: budgetMin, max: budgetMax, step: budgetStep } = useMemo(() => budgetBounds(currency), [currency]);

  // Convert the held budget when the user switches currency (not just the symbol).
  // NOTE: conversion reads `currency` from closure and uses a pure budget
  // updater — never nest setState updaters (StrictMode double-invokes them,
  // which previously converted twice: 2000 USD -> 166000 -> clamped 830000).
  const handleCurrencyChange = useCallback((next: Currency) => {
    if (next === currency) return;
    setBudget((b) => {
      const converted = convertCurrency(b, currency, next);
      const { min, max } = budgetBounds(next);
      return Math.min(max, Math.max(min, converted));
    });
    setCurrency(next);
  }, [currency]);

  useEffect(() => {
    const el = heroRef.current;
    if (!el) {
      setGlobeVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setGlobeVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!exampleTripsRef.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(
        exampleTripsRef.current!.children,
        { opacity: 0, y: 30 },
        {
          opacity: 1,
          y: 0,
          duration: 0.6,
          stagger: 0.1,
          ease: "power2.out",
          scrollTrigger: {
            trigger: exampleTripsRef.current,
            start: "top 80%",
            toggleActions: "play none none reverse",
          },
        }
      );
    }, exampleTripsRef);
    return () => ctx.revert();
  }, []);

  useEffect(() => {
    if (destination.trim().length < 3) return;
    const ctrl = new AbortController();
    const timeout = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/geocode?address=${encodeURIComponent(destination.trim())}`, { signal: ctrl.signal });
        if (!res.ok) {
          setCoords(null);
          setGeoWarning(res.status === 404 ? "We couldn't pin this destination on the globe — you can still generate the trip." : null);
          return;
        }
        const data = await res.json();
        setCoords({ lat: data.lat, lng: data.lng });
        setGeoWarning(null);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setCoords(null);
      }
    }, 500);
    return () => {
      window.clearTimeout(timeout);
      ctrl.abort();
    };
  }, [destination]);

  const destError = !touched ? null
    : destination.trim().length === 0 ? "Destination is required."
    : destination.trim().length < 2 ? "Destination must be at least 2 characters."
    : destination.trim().length > 120 ? "Destination must be 120 characters or fewer."
    : null;
  const budgetUSD = Number.isFinite(budget) ? convertCurrency(Math.round(budget), currency, "USD") : NaN;
  const budgetError = !touched ? null
    : !Number.isFinite(budgetUSD) ? "Budget must be a number."
    : budgetUSD < 200 ? `Budget must equal at least USD 200 (≈${formatCurrency(convertCurrency(200, "USD", currency), currency)}).`
    : budgetUSD > 100000 ? `Budget must equal at most USD 100,000 (≈${formatCurrency(convertCurrency(100000, "USD", currency), currency)}).`
    : null;
  const daysError = !touched ? null
    : !Number.isFinite(days) || days < 1 ? "Trip must be at least 1 day."
    : days > 14 ? "Trip can be at most 14 days."
    : null;
  const datesError = !touched ? null
    : (dateStart || dateEnd) && (!/^\d{4}-\d{2}-\d{2}$/.test(dateStart) || !/^\d{4}-\d{2}-\d{2}$/.test(dateEnd))
      ? "Travel dates must be valid dates."
      : dateStart && dateEnd && dateStart > dateEnd ? "End date must be after start date."
      : null;

  const formValid = !destError && !budgetError && !daysError && !datesError && destination.trim().length >= 2 && Number.isFinite(budgetUSD);

  const handlePlanTrip = useCallback((e?: React.FormEvent) => {
    e?.preventDefault();
    setTouched(true);
    if (submitGuard.current || isGenerating) return; // duplicate-click guard
    if (destination.trim().length < 2 || destination.trim().length > 120) return;
    const usd = Number.isFinite(budget) ? convertCurrency(Math.round(budget), currency, "USD") : NaN;
    if (!Number.isFinite(usd) || usd < 200 || usd > 100000) return;
    if (!Number.isFinite(days) || days < 1 || days > 14) return;
    if ((dateStart || dateEnd) && (!/^\d{4}-\d{2}-\d{2}$/.test(dateStart) || !/^\d{4}-\d{2}-\d{2}$/.test(dateEnd) || dateStart > dateEnd)) return;
    submitGuard.current = true;
    setIsGenerating(true);
    const q = new URLSearchParams({
      destination: destination.trim(),
      origin: origin.trim(),
      budget: String(Math.round(budget)),
      days: String(days),
      currency,
      travelers: String(travelers),
      accommodationLevel,
      travelStyle,
      transportPreference,
    });
    if (dateStart && dateEnd) {
      q.set("travelDatesStart", dateStart);
      q.set("travelDatesEnd", dateEnd);
    }
    router.push(`/plan/loading?${q.toString()}`);
  }, [destination, origin, budget, days, currency, travelers, accommodationLevel, travelStyle, transportPreference, dateStart, dateEnd, isGenerating, router]);

  const applyPopularTrip = useCallback((t: typeof POPULAR_TRIPS[number]) => {
    setDestination(t.destination);
    setDays(t.days);
    setBudget(convertCurrency(t.budgetUSD, "USD", currency));
    setTouched(false);
  }, [currency]);

  return (
    <main ref={heroRef} className="relative min-h-screen w-full overflow-hidden bg-bg-deep">
      <div className="absolute inset-0 z-0">
        {globeVisible ? <GlobeScene destination={coords} /> : null}
      </div>
      <ParticleLayer />

      <div className="relative z-10 flex flex-col items-center justify-center min-h-screen px-4 sm:px-6 lg:px-8">
        <div className="w-full max-w-2xl">
          <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-bold text-sand-light mb-3 tracking-tight text-center">
            Plan your <span className="italic text-gold-brass">escape</span>
          </h1>
          <p className="font-body text-base sm:text-lg text-sand-light/70 mb-8 max-w-lg mx-auto text-center">
            Enter a destination and budget. We&apos;ll build your day-by-day itinerary with real places, food, and routes.
          </p>

          <form onSubmit={handlePlanTrip} noValidate aria-label="Plan a trip" className="bg-bg-surface/80 backdrop-blur-md border border-gold-brass/20 rounded-2xl p-6 sm:p-8 shadow-2xl">
            <div className="space-y-6">
              <div>
                <label htmlFor="origin" className="block font-mono text-sm text-gold-brass mb-2 uppercase tracking-wider">
                  Departing from <span className="text-sand-light/40 normal-case">(optional)</span>
                </label>
                <input
                  id="origin"
                  name="origin"
                  type="text"
                  autoComplete="off"
                  maxLength={120}
                  value={origin}
                  onChange={(e) => setOrigin(e.target.value)}
                  placeholder="e.g. Hyderabad"
                  className="w-full bg-bg-deep/50 border border-sand-light/20 rounded-lg px-4 py-3 text-sand-light placeholder-sand-light/40 focus:outline-none focus:ring-2 focus:ring-gold-brass focus:border-transparent transition-all font-body"
                />
              </div>
              <div>
                <label htmlFor="destination" className="block font-mono text-sm text-gold-brass mb-2 uppercase tracking-wider">
                  Destination
                </label>
                <input
                  id="destination"
                  name="destination"
                  type="text"
                  autoComplete="off"
                  maxLength={120}
                  required
                  value={destination}
                  onChange={(e) => {
                    setDestination(e.target.value);
                    if (e.target.value.trim().length < 3) {
                      setCoords(null);
                      setGeoWarning(null);
                    }
                  }}
                  placeholder="e.g. Tokyo, Japan"
                  aria-invalid={destError ? true : undefined}
                  aria-describedby={destError ? "destination-error" : geoWarning ? "destination-geo" : undefined}
                  className="w-full bg-bg-deep/50 border border-sand-light/20 rounded-lg px-4 py-3 text-sand-light placeholder-sand-light/40 focus:outline-none focus:ring-2 focus:ring-gold-brass focus:border-transparent transition-all font-body"
                />
                {destError ? <p id="destination-error" role="alert" className="mt-2 font-mono text-xs text-coral-warm">{destError}</p> : null}
                {!destError && geoWarning ? <p id="destination-geo" role="status" className="mt-2 font-mono text-xs text-sand-light/60">{geoWarning}</p> : null}
              </div>

              <fieldset>
                <legend className="font-mono text-sm text-gold-brass mb-2 uppercase tracking-wider">Currency</legend>
                <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Currency">
                  {CURRENCY_LIST.map((c) => (
                    <button
                      key={c}
                      type="button"
                      role="radio"
                      aria-checked={currency === c}
                      onClick={() => handleCurrencyChange(c)}
                      className={`font-mono text-sm px-3 py-2 rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-gold-brass ${currency === c ? "bg-gold-brass text-bg-deep border-gold-brass font-bold" : "border-sand-light/20 text-sand-light/70 hover:border-gold-brass/50"}`}
                    >
                      {c} ({CURRENCIES[c].symbol})
                    </button>
                  ))}
                </div>
              </fieldset>

              <div>
                <label htmlFor="budget" className="block font-mono text-sm text-gold-brass mb-2 uppercase tracking-wider">
                  Budget ({currency} {CURRENCIES[currency].symbol})
                </label>
                <input
                  id="budget"
                  name="budget"
                  type="range"
                  min={budgetMin}
                  max={budgetMax}
                  step={budgetStep}
                  value={Math.min(budgetMax, Math.max(budgetMin, budget))}
                  onChange={(e) => setBudget(Number(e.target.value))}
                  aria-invalid={budgetError ? true : undefined}
                  aria-describedby={budgetError ? "budget-error" : "budget-value"}
                  className="w-full h-2 bg-bg-deep/50 rounded-lg appearance-none cursor-pointer accent-gold-brass"
                />
                <div className="flex justify-between mt-2 font-mono text-sm text-sand-light/70">
                  <span>{formatCurrency(budgetMin, currency)}</span>
                  <span id="budget-value" className="text-gold-brass font-semibold">{formatCurrency(budget, currency)}</span>
                  <span>{formatCurrency(budgetMax, currency)}</span>
                </div>
                <label htmlFor="budget-number" className="sr-only">Exact budget in {currency}</label>
                <input
                  id="budget-number"
                  name="budget-number"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={10000000}
                  value={Number.isFinite(budget) ? budget : ""}
                  onChange={(e) => setBudget(Number(e.target.value))}
                  className="mt-3 w-full bg-bg-deep/50 border border-sand-light/20 rounded-lg px-4 py-2 text-sand-light font-mono text-sm focus:outline-none focus:ring-2 focus:ring-gold-brass"
                />
                {budgetError ? <p id="budget-error" role="alert" className="mt-2 font-mono text-xs text-coral-warm">{budgetError}</p> : null}
              </div>

              <div>
                <label htmlFor="days" className="block font-mono text-sm text-gold-brass mb-2 uppercase tracking-wider">
                  Trip length
                </label>
                <div className="flex items-center gap-3">
                  <input id="days" name="days" type="range" min={1} max={14} value={Math.min(14, Math.max(1, days))} onChange={(e) => setDays(Number(e.target.value))} aria-invalid={daysError ? true : undefined} aria-describedby={daysError ? "days-error" : undefined} className="w-full h-2 bg-bg-deep/50 rounded-lg appearance-none cursor-pointer accent-gold-brass" />
                  <span className="font-mono text-sm text-gold-brass w-20 text-right" aria-live="polite">{days} days</span>
                </div>
                {daysError ? <p id="days-error" role="alert" className="mt-2 font-mono text-xs text-coral-warm">{daysError}</p> : null}
              </div>

              <details className="border border-sand-light/15 rounded-lg p-4">
                <summary className="font-mono text-sm text-gold-brass uppercase tracking-wider cursor-pointer focus:outline-none focus:ring-2 focus:ring-gold-brass rounded">
                  Trip options (optional)
                </summary>
                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="date-start" className="block font-mono text-xs text-sand-light/70 mb-1 uppercase">Start date</label>
                    <input id="date-start" name="date-start" type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} className="w-full bg-bg-deep/50 border border-sand-light/20 rounded-lg px-3 py-2 text-sand-light font-body text-sm focus:outline-none focus:ring-2 focus:ring-gold-brass" />
                  </div>
                  <div>
                    <label htmlFor="date-end" className="block font-mono text-xs text-sand-light/70 mb-1 uppercase">End date</label>
                    <input id="date-end" name="date-end" type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} className="w-full bg-bg-deep/50 border border-sand-light/20 rounded-lg px-3 py-2 text-sand-light font-body text-sm focus:outline-none focus:ring-2 focus:ring-gold-brass" />
                  </div>
                  <div>
                    <label htmlFor="travelers" className="block font-mono text-xs text-sand-light/70 mb-1 uppercase">Travelers</label>
                    <input id="travelers" name="travelers" type="number" min={1} max={20} value={travelers} onChange={(e) => setTravelers(Math.min(20, Math.max(1, Number(e.target.value) || 1)))} className="w-full bg-bg-deep/50 border border-sand-light/20 rounded-lg px-3 py-2 text-sand-light font-body text-sm focus:outline-none focus:ring-2 focus:ring-gold-brass" />
                  </div>
                  <div>
                    <label htmlFor="accommodation" className="block font-mono text-xs text-sand-light/70 mb-1 uppercase">Accommodation</label>
                    <select id="accommodation" name="accommodation" value={accommodationLevel} onChange={(e) => setAccommodationLevel(e.target.value as "budget" | "mid" | "luxury")} className="w-full bg-bg-deep/50 border border-sand-light/20 rounded-lg px-3 py-2 text-sand-light font-body text-sm focus:outline-none focus:ring-2 focus:ring-gold-brass">
                      <option value="budget">Budget</option>
                      <option value="mid">Mid-range</option>
                      <option value="luxury">Luxury</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="travel-style" className="block font-mono text-xs text-sand-light/70 mb-1 uppercase">Travel style</label>
                    <select id="travel-style" name="travel-style" value={travelStyle} onChange={(e) => setTravelStyle(e.target.value as "relaxed" | "balanced" | "packed")} className="w-full bg-bg-deep/50 border border-sand-light/20 rounded-lg px-3 py-2 text-sand-light font-body text-sm focus:outline-none focus:ring-2 focus:ring-gold-brass">
                      <option value="relaxed">Relaxed</option>
                      <option value="balanced">Balanced</option>
                      <option value="packed">Packed</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="transport" className="block font-mono text-xs text-sand-light/70 mb-1 uppercase">Transport</label>
                    <select id="transport" name="transport" value={transportPreference} onChange={(e) => setTransportPreference(e.target.value as "public" | "mixed" | "private")} className="w-full bg-bg-deep/50 border border-sand-light/20 rounded-lg px-3 py-2 text-sand-light font-body text-sm focus:outline-none focus:ring-2 focus:ring-gold-brass">
                      <option value="public">Public transit</option>
                      <option value="mixed">Mixed</option>
                      <option value="private">Private / taxi</option>
                    </select>
                  </div>
                </div>
                {datesError ? <p role="alert" className="mt-3 font-mono text-xs text-coral-warm">{datesError}</p> : null}
              </details>

              <button
                type="submit"
                disabled={!formValid || isGenerating}
                aria-busy={isGenerating}
                className="w-full bg-gold-brass hover:bg-gold-brass/90 disabled:bg-sand-light/20 disabled:text-sand-light/40 text-bg-deep font-display font-bold text-lg py-4 rounded-lg transition-all duration-300 hover:shadow-lg hover:shadow-gold-brass/20 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-gold-brass focus:ring-offset-2 focus:ring-offset-bg-deep"
              >
                {isGenerating ? "Charting your course..." : "Plan the trip"}
              </button>
            </div>
          </form>

          <div className="mt-16" ref={exampleTripsRef}>
            <h2 className="font-display text-2xl sm:text-3xl font-semibold text-sand-light mb-2 text-center">
              Popular <span className="italic text-gold-brass">trips</span>
            </h2>
            <p className="font-mono text-xs text-sand-light/50 mb-6 text-center uppercase tracking-wider">Sample ideas — select one to pre-fill the form</p>
            <div className="flex gap-6 overflow-x-auto pb-4 scrollbar-hide justify-center sm:justify-start flex-wrap sm:flex-nowrap">
              {POPULAR_TRIPS.map((trip) => (
                <button
                  key={trip.destination}
                  type="button"
                  onClick={() => applyPopularTrip(trip)}
                  aria-label={`Use popular trip ${trip.destination}, ${trip.days} days, ${formatCurrency(convertCurrency(trip.budgetUSD, "USD", currency), currency)}`}
                  className="flex-shrink-0 w-64 sm:w-72 bg-bg-surface border border-sand-light/10 rounded-xl overflow-hidden hover:border-gold-brass/40 transition-all duration-300 group cursor-pointer text-left focus:outline-none focus:ring-2 focus:ring-gold-brass"
                >
                  <div className="h-40 bg-gradient-to-br from-gold-brass/20 to-coral-warm/20 relative">
                    <div className="absolute inset-0 flex items-center justify-center px-4">
                      <span className="font-display text-xl font-bold text-sand-light/80 group-hover:text-gold-brass transition-colors text-center">
                        {trip.destination}
                      </span>
                    </div>
                  </div>
                  <div className="p-4">
                    <p className="font-body text-xs text-sand-light/60 mb-2">{trip.blurb}</p>
                    <div className="flex justify-between items-center mb-2">
                      <span className="font-mono text-xs text-sand-light/50 uppercase tracking-wider">
                        {trip.days} Days
                      </span>
                      <span className="font-mono text-sm text-gold-brass">{formatCurrency(convertCurrency(trip.budgetUSD, "USD", currency), currency)}</span>
                    </div>
                    <div className="h-px bg-sand-light/10 mb-3"></div>
                    <div className="flex justify-between items-center">
                      <span className="font-mono text-xs text-sand-light/40">SAMPLE</span>
                      <span className="font-mono text-xs text-sand-light/40">DAY 01 · {formatCurrency(convertCurrency(trip.budgetUSD, "USD", currency), currency)}</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-bg-deep flex items-center justify-center"><div className="w-8 h-8 border-2 border-gold-brass border-t-transparent rounded-full animate-spin" /></main>}>
      <HomeInner />
    </Suspense>
  );
}
