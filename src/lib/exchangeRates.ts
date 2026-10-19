/**
 * Server-only live exchange-rate source.
 *
 * Why this exists: the informational "≈ $X USD" market-rate line on the plan
 * form should reflect the real market, but trip math, validation, and stored
 * trips stay on the deterministic reference table in lib/types.ts. This module
 * therefore NEVER feeds stored amounts — it only powers a read-only hint.
 *
 * Safeguards:
 * - 3s timeout via AbortController (a hung provider never hangs a request).
 * - 30-minute in-memory cache (TTL) so one provider call serves many users.
 * - On refresh failure: serve the last good cache marked `stale`, and if there
 *   is nothing cached fall back to the static reference table. It never throws,
 *   so callers never surface NaN.
 * - The provider API key is read from `process.env.EXCHANGE_RATE_API_KEY` in
 *   this server module only; it is never sent to the browser. Without a key we
 *   use the keyless ECB provider (Frankfurter).
 */
import { CURRENCIES, CURRENCY_CODES } from "./types";
import type { Currency } from "./types";

const PROVIDER_TIMEOUT_MS = 3000;
const CACHE_TTL_MS = 30 * 60 * 1000;

export interface ExchangeRates {
  base: "USD";
  /** 1 USD = rates[CODE] */
  rates: Partial<Record<Currency, number>>;
  /** Provider's own publish time (ISO 8601), or null when unknown. */
  updatedAt: string | null;
  /** When this server obtained these values (ISO 8601). */
  retrievedAt: string;
  source: "live" | "cache" | "static";
  /** True when we could not refresh and are serving older/static values. */
  stale: boolean;
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type Now = () => number;

let cache: { data: ExchangeRates; expiresAt: number } | null = null;

/** Reference rates derived from the deterministic table (1 USD = X). */
export function staticRates(): Record<Currency, number> {
  const out = {} as Record<Currency, number>;
  for (const code of CURRENCY_CODES) {
    out[code] = CURRENCIES[code].minorPerUSD / 10 ** CURRENCIES[code].decimals;
  }
  return out;
}

function staticSnapshot(now: Now): ExchangeRates {
  return {
    base: "USD",
    rates: staticRates(),
    updatedAt: null,
    retrievedAt: new Date(now()).toISOString(),
    source: "static",
    stale: true,
  };
}

function toIsoOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

async function fetchFromProvider(fetchImpl: FetchLike, now: Now): Promise<ExchangeRates> {
  const apiKey = process.env.EXCHANGE_RATE_API_KEY;
  const url = apiKey
    ? `https://v6.exchangerate-api.com/v6/${encodeURIComponent(apiKey)}/latest/USD`
    : "https://api.frankfurter.app/latest?from=USD";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { signal: controller.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`Exchange rate provider returned HTTP ${res.status}`);
    const json = (await res.json()) as Record<string, unknown>;

    const raw = (json.conversion_rates ?? json.rates) as Record<string, unknown> | undefined;
    if (!raw || typeof raw !== "object") throw new Error("Malformed exchange rate response");

    const rates: Partial<Record<Currency, number>> = { USD: 1 };
    for (const code of CURRENCY_CODES) {
      const value = raw[code];
      if (typeof value === "number" && Number.isFinite(value) && value > 0) rates[code] = value;
    }
    // Refuse a response that carries no usable rate beyond the base.
    if (Object.keys(rates).length <= 1) throw new Error("Exchange rate response had no usable rates");

    const updatedAt = toIsoOrNull(json.time_last_update_utc) ??
      toIsoOrNull(typeof json.date === "string" ? `${json.date}T00:00:00Z` : null);

    return {
      base: "USD",
      rates,
      updatedAt,
      retrievedAt: new Date(now()).toISOString(),
      source: "live",
      stale: false,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Returns rates for the supported currencies. Never rejects; on total failure
 * it returns the static reference snapshot.
 */
export async function getExchangeRates(deps?: { fetchImpl?: FetchLike; now?: Now }): Promise<ExchangeRates> {
  const now = deps?.now ?? Date.now;
  const fetchImpl = deps?.fetchImpl ?? (globalThis.fetch as FetchLike);
  const t = now();

  if (cache && cache.expiresAt > t) {
    return { ...cache.data, source: "cache", stale: false };
  }

  try {
    const fresh = await fetchFromProvider(fetchImpl, now);
    cache = { data: fresh, expiresAt: t + CACHE_TTL_MS };
    return fresh;
  } catch {
    if (cache) {
      // Last good values are still better than a blank line; mark them stale so
      // the UI can say "as of <time>" instead of pretending they are current.
      return { ...cache.data, source: "cache", stale: true };
    }
    return staticSnapshot(now);
  }
}

/** Test hook: clear the module-level cache between cases. */
export function __resetExchangeRateCache() {
  cache = null;
}
