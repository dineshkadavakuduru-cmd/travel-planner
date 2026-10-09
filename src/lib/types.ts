export type Currency = "USD" | "INR" | "EUR" | "GBP";

export interface CurrencyInfo {
  code: Currency;
  symbol: string;
  name: string;
  rateToUSD: number; // 1 USD = X of this currency
}

/**
 * Exchange rates are STATIC reference rates (1 USD = X), reviewed manually.
 * They are intentionally not fetched live: trip budgets must be deterministic
 * and reproducible (validation, saved trips, share/export all reuse them).
 * To update: change the numbers below — every surface (form, API validation,
 * itinerary costs, saved-trip cards, export) follows automatically via
 * convertCurrency/formatCurrency. No other file hardcodes a rate.
 */
export const CURRENCIES: Record<Currency, CurrencyInfo> = {
  USD: { code: "USD", symbol: "$", name: "US Dollar", rateToUSD: 1 },
  INR: { code: "INR", symbol: "₹", name: "Indian Rupee", rateToUSD: 83 },
  EUR: { code: "EUR", symbol: "€", name: "Euro", rateToUSD: 0.92 },
  GBP: { code: "GBP", symbol: "£", name: "British Pound", rateToUSD: 0.79 },
};

export function convertCurrency(amount: number, from: Currency, to: Currency): number {
  if (from === to) return amount;
  const usdAmount = amount / CURRENCIES[from].rateToUSD;
  return Math.round(usdAmount * CURRENCIES[to].rateToUSD);
}

const LOCALE: Record<Currency, string> = {
  USD: "en-US",
  INR: "en-IN", // lakh/crore grouping: 1,66,000
  EUR: "en-US",
  GBP: "en-US",
};

export function formatCurrency(amount: number, currency: Currency): string {
  const info = CURRENCIES[currency];
  return `${info.symbol}${amount.toLocaleString(LOCALE[currency])}`;
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
}

/** Shape of the raw Firestore document (Timestamp fields not yet serialized). */
export interface TripDocument {
  id: string;
  createdAt?: { toDate?: () => Date; seconds?: number } | string | Date | unknown;
  [key: string]: unknown;
}

export function toTrip(doc: TripDocument, data: Record<string, unknown>): Trip {
  const raw = data.createdAt as TripDocument["createdAt"];
  let createdAt: Date | string = new Date().toISOString();
  if (typeof raw === "string") createdAt = raw;
  else if (raw instanceof Date) createdAt = raw.toISOString();
  else if (raw && typeof raw === "object") {
    if (typeof (raw as { toDate?: unknown }).toDate === "function") {
      createdAt = (raw as { toDate: () => Date }).toDate().toISOString();
    } else if (typeof (raw as { seconds?: unknown }).seconds === "number") {
      createdAt = new Date((raw as { seconds: number }).seconds * 1000).toISOString();
    }
  }
  return { ...(data as unknown as Omit<Trip, "id" | "createdAt">), id: doc.id, createdAt };
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
