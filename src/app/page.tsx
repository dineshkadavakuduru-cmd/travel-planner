"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import ParticleLayer from "@/components/ParticleLayer";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

const GlobeScene = dynamic(() => import("@/components/Globe"), {
  ssr: false,
  loading: () => <div className="w-full h-full bg-bg-deep" aria-hidden="true" />,
});

gsap.registerPlugin(ScrollTrigger);

export default function Home() {
  const router = useRouter();
  const [destination, setDestination] = useState("");
  const [origin, setOrigin] = useState("");
  const [budget, setBudget] = useState(1000);
  const [days, setDays] = useState(3);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [globeVisible, setGlobeVisible] = useState(false);
  const exampleTripsRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);

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

  const geocode = useCallback(async (value: string, setter: (coords: { lat: number; lng: number } | null) => void) => {
    if (value.trim().length < 3) {
      setter(null);
      return;
    }
    try {
      const res = await fetch(`/api/geocode?address=${encodeURIComponent(value)}`);
      if (!res.ok) return;
      const data = await res.json();
      setter({ lat: data.lat, lng: data.lng });
    } catch (error) {
      console.error("Geocoding failed:", error);
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => void geocode(destination, setCoords), 500);
    return () => window.clearTimeout(timeout);
  }, [destination, geocode]);

  const handleDestinationChange = useCallback((value: string) => setDestination(value), []);

  const handlePlanTrip = useCallback(async () => {
    if (!destination || !coords) return;
    setIsGenerating(true);
    router.push(`/plan/loading?destination=${encodeURIComponent(destination)}&origin=${encodeURIComponent(origin)}&budget=${budget}&days=${days}`);
  }, [destination, coords, origin, budget, days, router]);

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

          <div className="bg-bg-surface/80 backdrop-blur-md border border-gold-brass/20 rounded-2xl p-6 sm:p-8 shadow-2xl">
             <div className="space-y-6">
              <div>
                <label htmlFor="origin" className="block font-mono text-sm text-gold-brass mb-2 uppercase tracking-wider">
                  Departing from <span className="text-sand-light/40 normal-case">(optional)</span>
                </label>
                <input
                  id="origin"
                  type="text"
                  value={origin}
                  onChange={(e) => setOrigin(e.target.value)}
                  placeholder="e.g. New York"
                  className="w-full bg-bg-deep/50 border border-sand-light/20 rounded-lg px-4 py-3 text-sand-light placeholder-sand-light/40 focus:outline-none focus:ring-2 focus:ring-gold-brass focus:border-transparent transition-all font-body"
                />
              </div>
              <div>
                <label htmlFor="destination" className="block font-mono text-sm text-gold-brass mb-2 uppercase tracking-wider">
                  Destination
                </label>
                <input
                  id="destination"
                  type="text"
                  value={destination}
                  onChange={(e) => handleDestinationChange(e.target.value)}
                  placeholder="e.g. Tokyo, Japan"
                  className="w-full bg-bg-deep/50 border border-sand-light/20 rounded-lg px-4 py-3 text-sand-light placeholder-sand-light/40 focus:outline-none focus:ring-2 focus:ring-gold-brass focus:border-transparent transition-all font-body"
                />
              </div>

              <div>
                <label htmlFor="budget" className="block font-mono text-sm text-gold-brass mb-2 uppercase tracking-wider">
                  Budget (USD)
                </label>
                <input
                  id="budget"
                  type="range"
                  min={200}
                  max={5000}
                  step={100}
                  value={budget}
                  onChange={(e) => setBudget(Number(e.target.value))}
                  className="w-full h-2 bg-bg-deep/50 rounded-lg appearance-none cursor-pointer accent-gold-brass"
                />
                <div className="flex justify-between mt-2 font-mono text-sm text-sand-light/70">
                  <span>$200</span>
                  <span className="text-gold-brass font-semibold">${budget}</span>
                  <span>$5,000</span>
                </div>
              </div>

              <div>
                <label htmlFor="days" className="block font-mono text-sm text-gold-brass mb-2 uppercase tracking-wider">
                  Trip length
                </label>
                <div className="flex items-center gap-3">
                  <input id="days" type="range" min={1} max={14} value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-full h-2 bg-bg-deep/50 rounded-lg appearance-none cursor-pointer accent-gold-brass" />
                  <span className="font-mono text-sm text-gold-brass w-20 text-right">{days} days</span>
                </div>
              </div>

              <button
                onClick={handlePlanTrip}
                disabled={!destination || !coords || isGenerating}
                className="w-full bg-gold-brass hover:bg-gold-brass/90 disabled:bg-sand-light/20 disabled:text-sand-light/40 text-bg-deep font-display font-bold text-lg py-4 rounded-lg transition-all duration-300 hover:shadow-lg hover:shadow-gold-brass/20 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-gold-brass focus:ring-offset-2 focus:ring-offset-bg-deep"
              >
                {isGenerating ? "Charting your course..." : "Plan the trip"}
              </button>
            </div>
          </div>

          <div className="mt-16" ref={exampleTripsRef}>
            <h2 className="font-display text-2xl sm:text-3xl font-semibold text-sand-light mb-6 text-center">
              Recent <span className="italic text-gold-brass">departures</span>
            </h2>
            <div className="flex gap-6 overflow-x-auto pb-4 scrollbar-hide justify-center sm:justify-start flex-wrap sm:flex-nowrap">
              {[
                { destination: "Tokyo, Japan", days: 5, budget: 1200 },
                { destination: "Paris, France", days: 4, budget: 1800 },
                { destination: "Barcelona, Spain", days: 3, budget: 900 },
                { destination: "Bali, Indonesia", days: 7, budget: 1500 },
              ].map((trip, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => { setDestination(trip.destination); setBudget(trip.budget); setDays(trip.days); }}
                  className="flex-shrink-0 w-64 sm:w-72 bg-bg-surface border border-sand-light/10 rounded-xl overflow-hidden hover:border-gold-brass/40 transition-all duration-300 group cursor-pointer"
                >
                  <div className="h-40 bg-gradient-to-br from-gold-brass/20 to-coral-warm/20 relative">
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="font-display text-xl font-bold text-sand-light/80 group-hover:text-gold-brass transition-colors">
                        {trip.destination}
                      </span>
                    </div>
                  </div>
                  <div className="p-4">
                    <div className="flex justify-between items-center mb-2">
                      <span className="font-mono text-xs text-sand-light/50 uppercase tracking-wider">
                        {trip.days} Days
                      </span>
                      <span className="font-mono text-sm text-gold-brass">${trip.budget}</span>
                    </div>
                    <div className="h-px bg-sand-light/10 mb-3"></div>
                    <div className="flex justify-between items-center">
                      <span className="font-mono text-xs text-sand-light/40">FLIGHT READY</span>
                      <span className="font-mono text-xs text-sand-light/40">DAY 01 · BUDGET ${trip.budget}</span>
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
