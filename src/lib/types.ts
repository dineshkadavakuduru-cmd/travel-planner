export type Currency = "USD" | "INR" | "EUR" | "GBP" | "JPY" | "KWD";

export interface CurrencyInfo {
  code: Currency;
  symbol: string;
  name: string;
  /** Number of minor-unit digits: USD 2, JPY 0, KWD 3. */
  decimals: number;
  /**
   * Exact number of minor units that equal 1 USD, as a positive integer.
   * e.g. USD 100 (= 100 cents), INR 8300 (= ₹83.00), KWD 307 (= 0.307).
   * Storing the rate as an integer in the target's minor unit lets all
   * conversions run in BigInt without floating-point drift.
   */
  minorPerUSD: number;
  /** BCP-47 locale used for deterministic grouping (INR lakh/crore). */
  locale: string;
}

/**
 * Exchange rates are STATIC reference rates (1 USD = X), reviewed manually.
 * They are intentionally not fetched live for trip math: trip budgets must be
 * deterministic and reproducible (validation, saved trips, share/export all
 * reuse them). The informational "market rate" line on the form is separate
 * and may use a live source (see lib/exchangeRates.ts) — it never affects
 * stored amounts. To update a reference rate: change minorPerUSD below — every
 * surface (form, API validation, itinerary costs, saved-trip cards, export)
 * follows automatically via convertCurrency/formatCurrency. No other file
 * hardcodes a reference rate.
 */
export const CURRENCIES: Record<Currency, CurrencyInfo> = {
  USD: { code: "USD", symbol: "$", name: "US Dollar", decimals: 2, minorPerUSD: 100, locale: "en-US" },
  INR: { code: "INR", symbol: "₹", name: "Indian Rupee", decimals: 2, minorPerUSD: 8300, locale: "en-IN" },
  EUR: { code: "EUR", symbol: "€", name: "Euro", decimals: 2, minorPerUSD: 92, locale: "en-US" },
  GBP: { code: "GBP", symbol: "£", name: "British Pound", decimals: 2, minorPerUSD: 79, locale: "en-US" },
  // 0-decimal currency: amounts are whole yen.
  JPY: { code: "JPY", symbol: "¥", name: "Japanese Yen", decimals: 0, minorPerUSD: 157, locale: "en-US" },
  // 3-decimal currency: amounts are whole fils (1 KWD = 1000 fils).
  KWD: { code: "KWD", symbol: "KD", name: "Kuwaiti Dinar", decimals: 3, minorPerUSD: 307, locale: "en-US" },
};

export const CURRENCY_CODES = ["USD", "INR", "EUR", "GBP", "JPY", "KWD"] as const satisfies readonly Currency[];

/** Budget limits expressed in USD-equivalent. */
export const USD_BUDGET_MIN = 200;
export const USD_BUDGET_MAX = 100000;
/** Sanity bounds on the raw integer a client may send, in its own currency. */
export const RAW_BUDGET_MIN = 1;
/** Large enough for the highest-rate supported currency (JPY ≈ ¥15.7M at the cap). */
export const RAW_BUDGET_MAX = 100000000;

/** Convert a major-unit amount to exact integer minor units (half-up). */
export function toMinorUnits(amount: number, currency: Currency): bigint {
  if (!Number.isFinite(amount)) throw new RangeError(`toMinorUnits: non-finite amount ${amount}`);
  const scale = 10 ** CURRENCIES[currency].decimals;
  const scaled = Math.round(amount * scale);
  if (!Number.isFinite(scaled)) throw new RangeError(`toMinorUnits: amount ${amount} out of range`);
  return BigInt(scaled);
}

/** Convert integer minor units back to a major-unit number. */
export function fromMinorUnits(minor: bigint, currency: Currency): number {
  return Number(minor) / 10 ** CURRENCIES[currency].decimals;
}

/**
 * Convert between currencies using integer minor units and BigInt arithmetic,
 * so there is no `amount / rate * rate` floating-point drift. Rounds half-up at
 * the target currency's precision (JPY → whole yen, KWD → 3 decimals).
 */
export function convertCurrency(amount: number, from: Currency, to: Currency): number {
  if (from === to) return amount;
  if (!Number.isFinite(amount)) return amount; // Callers guard; never fabricate NaN math.
  const fromMinor = toMinorUnits(amount, from);
  const fromPerUSD = BigInt(CURRENCIES[from].minorPerUSD);
  const toPerUSD = BigInt(CURRENCIES[to].minorPerUSD);
  // round half-up: (a*b + divisor/2) / divisor, all non-negative here.
  const toMinor = (fromMinor * toPerUSD + fromPerUSD / 2n) / fromPerUSD;
  return fromMinorUnits(toMinor, to);
}

/**
 * Format a major-unit amount with a pinned locale per currency, so output is
 * byte-identical on the server (Node ICU) and client (browser ICU). Fraction
 * digits follow the currency: JPY shows none, KWD up to three.
 */
export function formatCurrency(amount: number, currency: Currency): string {
  const info = CURRENCIES[currency];
  if (!Number.isFinite(amount)) return `${info.symbol}—`;
  const formatter = new Intl.NumberFormat(info.locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: info.decimals,
  });
  return `${info.symbol}${formatter.format(amount)}`;
}

/** Coerce unknown stored values (e.g. pre-currency trips) to a valid code. */
export function resolveCurrency(code: unknown): Currency {
  return typeof code === "string" && code in CURRENCIES ? (code as Currency) : "USD";
}

export interface Spot {
  name: string;
  description: string;
  estTimeMinutes: number;
  placeId?: string;
  lat?: number;
  lng?: number;
}

export interface FoodPick {
  name: string;
  cuisine: string;
  priceTier: "budget" | "mid" | "splurge";
  placeId?: string;
  lat?: number;
  lng?: number;
}

export interface DayPlan {
  dayNumber: number;
  theme: string;
  spots: Spot[];
  food: FoodPick[];
}

export type TravelStyle = "relaxed" | "balanced" | "packed";
export type AccommodationLevel = "budget" | "mid" | "luxury";
export type TransportPreference = "public" | "mixed" | "private";

export interface TripOptions {
  travelDates?: { start: string; end: string };
  travelers?: number;
  accommodationLevel?: AccommodationLevel;
  travelStyle?: TravelStyle;
  transportPreference?: TransportPreference;
}

export interface Trip {
  id: string;
  ownerId?: string;
  destination: string;
  originAirportOrCity: string;
  budget: number;
  currency: Currency;
  createdAt: Date | string;
  updatedAt?: Date | string;
  days: DayPlan[];
  totalEstCost: number;
  isPublic: boolean;
  enriched?: boolean;
  options?: TripOptions;
  /** Bumped when the stored trip shape changes; see CURRENT_TRIP_SCHEMA_VERSION. */
  schemaVersion: number;
}

/** Shape of the raw Firestore document (Timestamp fields not yet serialized). */
export interface TripDocument {
  id: string;
  createdAt?: { toDate?: () => Date; seconds?: number } | string | Date | unknown;
  [key: string]: unknown;
}

/**
 * Bump when the persisted trip shape changes. Trips written before versioning
 * (v1) are migrated to v2 on read: currency filled in, numbers coerced,
 * malformed days dropped, schemaVersion stamped.
 */
export const CURRENT_TRIP_SCHEMA_VERSION = 2;

function normalizeCreatedAt(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw instanceof Date) return raw.toISOString();
  if (raw && typeof raw === "object") {
    if (typeof (raw as { toDate?: unknown }).toDate === "function") {
      return (raw as { toDate: () => Date }).toDate().toISOString();
    }
    if (typeof (raw as { seconds?: unknown }).seconds === "number") {
      return new Date((raw as { seconds: number }).seconds * 1000).toISOString();
    }
  }
  return new Date().toISOString();
}

function finiteOr(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeDayPlan(raw: unknown): DayPlan | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  const dayNumber = finiteOr(d.dayNumber, NaN);
  if (!Number.isFinite(dayNumber)) return null;
  const spots = Array.isArray(d.spots)
    ? (d.spots.filter((s) => s && typeof s === "object") as Spot[])
    : [];
  const food = Array.isArray(d.food)
    ? (d.food.filter((f) => f && typeof f === "object") as FoodPick[])
    : [];
  return {
    dayNumber,
    theme: typeof d.theme === "string" && d.theme ? d.theme : `Day ${dayNumber}`,
    spots,
    food,
  };
}

/**
 * Coerce a persisted/legacy trip into a well-formed Trip, or return null when
 * the data is unrecoverably corrupt (no `days` array at all). Pure and safe to
 * call on localStorage values, Firestore documents, and API responses.
 */
export function migrateTrip(raw: unknown): Trip | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  if (!Array.isArray(data.days)) return null;

  const days = (data.days as unknown[]).map(normalizeDayPlan).filter((d): d is DayPlan => d !== null);
  const destination = typeof data.destination === "string" && data.destination.trim()
    ? data.destination.trim().slice(0, 200)
    : "Untitled trip";
  const budget = finiteOr(data.budget, 0);
  const totalEstCost = finiteOr(data.totalEstCost, 0);
  const options = data.options && typeof data.options === "object" ? (data.options as TripOptions) : undefined;

  return {
    id: typeof data.id === "string" ? data.id : "",
    ownerId: typeof data.ownerId === "string" ? data.ownerId : undefined,
    destination,
    originAirportOrCity: typeof data.originAirportOrCity === "string" ? data.originAirportOrCity : "",
    budget: budget >= 0 ? budget : 0,
    currency: resolveCurrency(data.currency),
    createdAt: normalizeCreatedAt(data.createdAt),
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : undefined,
    days,
    totalEstCost: totalEstCost >= 0 ? totalEstCost : 0,
    isPublic: data.isPublic === true,
    enriched: data.enriched === true,
    options,
    schemaVersion: CURRENT_TRIP_SCHEMA_VERSION,
  };
}

export function toTrip(doc: TripDocument, data: Record<string, unknown>): Trip {
  const migrated = migrateTrip({ ...data, id: doc.id });
  if (!migrated) throw new Error("Corrupt trip document: missing days array");
  return migrated;
}

export interface ItineraryResponse {
  days: DayPlan[];
  totalEstCost: number;
}

export interface GenerateItineraryRequest {
  destination: string;
  origin: string;
  budget: number;
  days: number;
  currency?: Currency;
  options?: TripOptions;
}

export interface GenerateItineraryResponse {
  days: DayPlan[];
  totalEstCost: number;
}
