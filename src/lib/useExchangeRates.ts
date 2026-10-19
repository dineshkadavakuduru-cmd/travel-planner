"use client";

import { useEffect, useState } from "react";
import type { Currency } from "./types";

export interface MarketRates {
  base: "USD";
  rates: Partial<Record<Currency, number>>;
  updatedAt: string | null;
  retrievedAt: string;
  source: "live" | "cache" | "static";
  stale: boolean;
}

/**
 * Fetches the informational market-rate snapshot from our own API route.
 * Failure is silent by design: the caller simply hides the market-rate line
 * rather than rendering a bogus "NaN" value.
 */
export function useExchangeRates(timeoutMs = 4000) {
  const [data, setData] = useState<MarketRates | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/exchange-rates", { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as MarketRates;
        if (cancelled) return;
        if (json && json.rates && typeof json.rates === "object") {
          setData(json);
        } else {
          setFailed(true);
        }
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        clearTimeout(timer);
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [timeoutMs]);

  return { data, failed };
}

/** USD-equivalent of `amount` using a live market rate, or null when unknown. */
export function usdEquivalentAtMarketRate(
  amount: number,
  currency: Currency,
  data: MarketRates | null
): number | null {
  if (!data || currency === "USD") return currency === "USD" ? amount : null;
  if (!Number.isFinite(amount)) return null;
  const rate = data.rates[currency];
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) return null;
  const usd = amount / rate;
  return Number.isFinite(usd) ? usd : null;
}
