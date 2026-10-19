import { describe, expect, it } from "vitest";
import { sanitizeString, sanitizeTripData, tripRequestSchema } from "./schemas";
import {
  CURRENT_TRIP_SCHEMA_VERSION,
  convertCurrency,
  formatCurrency,
  fromMinorUnits,
  migrateTrip,
  resolveCurrency,
  toMinorUnits,
  toTrip,
} from "./types";

const validTrip = {
  destination: "Tokyo, Japan",
  originAirportOrCity: "New York",
  budget: 1200,
  currency: "USD",
  days: [
    {
      dayNumber: 1,
      theme: "Arrival",
      spots: [{ name: "Senso-ji", description: "Historic temple", estTimeMinutes: 90 }],
      food: [{ name: "Ichiran", cuisine: "Ramen", priceTier: "budget" }],
    },
  ],
  totalEstCost: 300,
  isPublic: false,
  enriched: true,
};

describe("sanitizeString", () => {
  it("strips HTML tags and angle brackets", () => {
    expect(sanitizeString('<script>alert("x")</script>hello', 100)).not.toContain("<");
    expect(sanitizeString("<b>bold</b>", 100)).toBe("bold");
  });

  it("truncates to max length", () => {
    expect(sanitizeString("abcdef", 3)).toBe("abc");
  });
});

describe("sanitizeTripData", () => {
  it("accepts a valid trip", () => {
    expect(() => sanitizeTripData(validTrip)).not.toThrow();
  });

  it("strips markup from free-text fields", () => {
    const dirty = {
      ...validTrip,
      destination: '<img src=x onerror=alert(1)>Tokyo',
    };
    const clean = sanitizeTripData(dirty);
    expect(clean.destination).not.toContain("<");
    expect(clean.destination).toContain("Tokyo");
  });

  it("rejects unknown/invalid shapes", () => {
    expect(() => sanitizeTripData({ destination: "x" })).toThrow();
    expect(() => sanitizeTripData(null)).toThrow();
  });
});

describe("tripRequestSchema", () => {
  it("rejects budgets outside range", () => {
    expect(tripRequestSchema.safeParse({ destination: "Tokyo", budget: 1, days: 3 }).success).toBe(false);
    expect(tripRequestSchema.safeParse({ destination: "Tokyo", budget: 1000, days: 3 }).success).toBe(true);
  });

  it("accepts the Hyderabad → Tokyo reference trip", () => {
    const r = tripRequestSchema.safeParse({ destination: "Tokyo", origin: "Hyderabad", budget: 2000, days: 5, currency: "USD" });
    expect(r.success).toBe(true);
    const inr = tripRequestSchema.safeParse({ destination: "Tokyo", origin: "Hyderabad", budget: 166000, days: 5, currency: "INR" });
    expect(inr.success).toBe(true);
  });

  it("rejects empty fields", () => {
    expect(tripRequestSchema.safeParse({ destination: "", budget: 1000, days: 3 }).success).toBe(false);
    expect(tripRequestSchema.safeParse({ destination: "x", budget: 1000, days: 3 }).success).toBe(false);
  });

  it("accepts special characters in destination", () => {
    expect(tripRequestSchema.safeParse({ destination: "São Paulo! @#$%", budget: 1000, days: 3 }).success).toBe(true);
  });

  it("rejects long destinations", () => {
    expect(tripRequestSchema.safeParse({ destination: "x".repeat(121), budget: 1000, days: 3 }).success).toBe(false);
  });

  it("rejects $0, negative, and huge budgets", () => {
    expect(tripRequestSchema.safeParse({ destination: "Tokyo", budget: 0, days: 3 }).success).toBe(false);
    expect(tripRequestSchema.safeParse({ destination: "Tokyo", budget: -500, days: 3 }).success).toBe(false);
    expect(tripRequestSchema.safeParse({ destination: "Tokyo", budget: 100000, days: 3 }).success).toBe(true);
    expect(tripRequestSchema.safeParse({ destination: "Tokyo", budget: 100001, days: 3 }).success).toBe(false);
    expect(tripRequestSchema.safeParse({ destination: "Tokyo", budget: 9999999, days: 3 }).success).toBe(false);
  });

  it("validates budgets in USD-equivalent across currencies", () => {
    // $2,000 reference trip expressed in INR / EUR / GBP must pass.
    expect(tripRequestSchema.safeParse({ destination: "Tokyo", budget: 166000, days: 5, currency: "INR" }).success).toBe(true);
    expect(tripRequestSchema.safeParse({ destination: "Tokyo", budget: 1840, days: 5, currency: "EUR" }).success).toBe(true);
    expect(tripRequestSchema.safeParse({ destination: "Tokyo", budget: 1580, days: 5, currency: "GBP" }).success).toBe(true);
    // Dust amounts (≈$1) must fail in any currency.
    expect(tripRequestSchema.safeParse({ destination: "Tokyo", budget: 100, days: 3, currency: "INR" }).success).toBe(false);
    expect(tripRequestSchema.safeParse({ destination: "Tokyo", budget: 1, days: 3, currency: "EUR" }).success).toBe(false);
  });

  it("rejects 0 days and 30 days, accepts 1 and 14", () => {
    expect(tripRequestSchema.safeParse({ destination: "Tokyo", budget: 1000, days: 0 }).success).toBe(false);
    expect(tripRequestSchema.safeParse({ destination: "Tokyo", budget: 1000, days: 1 }).success).toBe(true);
    expect(tripRequestSchema.safeParse({ destination: "Tokyo", budget: 1000, days: 14 }).success).toBe(true);
    expect(tripRequestSchema.safeParse({ destination: "Tokyo", budget: 1000, days: 30 }).success).toBe(false);
  });

  it("defaults currency to USD and accepts all supported codes", () => {
    expect(tripRequestSchema.parse({ destination: "Tokyo", budget: 1000, days: 3 }).currency).toBe("USD");
    // ≈$1,000 in each currency — all must pass the USD-equivalent range.
    const perCurrency: Array<["USD" | "INR" | "EUR" | "GBP", number]> = [
      ["USD", 1000],
      ["INR", 83000],
      ["EUR", 920],
      ["GBP", 790],
    ];
    for (const [currency, budget] of perCurrency) {
      expect(tripRequestSchema.safeParse({ destination: "Tokyo", budget, days: 3, currency }).success).toBe(true);
    }
    expect(tripRequestSchema.safeParse({ destination: "Tokyo", budget: 1000, days: 3, currency: "XYZ" }).success).toBe(false);
  });

  it("accepts optional trip options", () => {
    const r = tripRequestSchema.safeParse({
      destination: "Tokyo", budget: 2000, days: 5,
      options: { travelers: 2, accommodationLevel: "luxury", travelStyle: "packed", transportPreference: "private", travelDates: { start: "2026-11-01", end: "2026-11-05" } },
    });
    expect(r.success).toBe(true);
  });

  it("rejects travel dates whose end precedes the start", () => {
    const bad = tripRequestSchema.safeParse({
      destination: "Tokyo", budget: 2000, days: 5,
      options: { travelDates: { start: "2026-11-05", end: "2026-11-01" } },
    });
    expect(bad.success).toBe(false);
  });
});

describe("currency", () => {
  it("converts amounts between currencies (not just the symbol)", () => {
    expect(convertCurrency(100, "USD", "USD")).toBe(100);
    expect(convertCurrency(83, "INR", "USD")).toBe(1);
    expect(convertCurrency(1, "USD", "INR")).toBe(83);
    expect(convertCurrency(2000, "USD", "INR")).toBe(166000);
  });

  it("round-trips integer reference amounts exactly (no float drift)", () => {
    for (const [currency, amount] of [
      ["INR", 8300],
      ["EUR", 92],
      ["GBP", 79],
      ["KWD", 30.7],
      ["JPY", 15700],
    ] as const) {
      expect(convertCurrency(convertCurrency(100, "USD", currency), currency, "USD")).toBe(100);
      expect(convertCurrency(convertCurrency(amount, currency, "USD"), "USD", currency)).toBe(amount);
    }
  });

  it("handles zero and non-finite amounts without throwing or fabricating NaN math", () => {
    expect(convertCurrency(0, "USD", "INR")).toBe(0);
    expect(convertCurrency(0, "JPY", "KWD")).toBe(0);
    expect(Number.isNaN(convertCurrency(NaN, "USD", "INR"))).toBe(true);
    expect(convertCurrency(Infinity, "USD", "INR")).toBe(Infinity);
  });

  it("handles huge amounts without overflow", () => {
    expect(convertCurrency(1_000_000_000, "USD", "INR")).toBe(83_000_000_000);
    expect(Number.isFinite(convertCurrency(1e12, "INR", "USD"))).toBe(true);
    expect(toMinorUnits(1e12, "USD")).toBe(BigInt(1e14));
  });

  it("respects 0-decimal (JPY) and 3-decimal (KWD) minor units", () => {
    expect(convertCurrency(100, "USD", "JPY")).toBe(15700);
    expect(convertCurrency(157, "JPY", "USD")).toBe(1);
    expect(toMinorUnits(100, "JPY")).toBe(100n);
    expect(convertCurrency(1, "USD", "KWD")).toBe(0.307);
    expect(toMinorUnits(0.307, "KWD")).toBe(307n);
    expect(fromMinorUnits(307n, "KWD")).toBe(0.307);
  });

  it("rounds half-up at the target currency precision", () => {
    // 1 USD = 0.307 KWD, so 1 KWD = 3.257 USD -> 3.26 at 2 decimals.
    expect(convertCurrency(1, "KWD", "USD")).toBe(3.26);
    // 1 JPY = $0.006369... -> 0.01 at 2 decimals (half-up on the minor unit).
    expect(convertCurrency(1, "JPY", "USD")).toBe(0.01);
  });

  it("formats with the right symbol and currency precision", () => {
    expect(formatCurrency(2000, "USD")).toContain("$");
    expect(formatCurrency(166000, "INR")).toContain("₹");
    expect(formatCurrency(100, "EUR")).toContain("€");
    expect(formatCurrency(100, "GBP")).toContain("£");
    expect(formatCurrency(15700, "JPY")).toBe("¥15,700");
    expect(formatCurrency(0.307, "KWD")).toBe("KD0.307");
  });

  it("resolveCurrency falls back to USD for unknown/legacy values", () => {
    expect(resolveCurrency("INR")).toBe("INR");
    expect(resolveCurrency("USD")).toBe("USD");
    expect(resolveCurrency("KWD")).toBe("KWD");
    expect(resolveCurrency("XYZ")).toBe("USD");
    expect(resolveCurrency(undefined)).toBe("USD");
    expect(resolveCurrency(null)).toBe("USD");
  });

  it("saved-trip cards never render INR amounts with $", () => {
    // Regression: trips/page rendered `${trip.budget}` regardless of currency.
    // INR uses en-IN lakh grouping deterministically on every machine.
    expect(formatCurrency(166000, resolveCurrency("INR"))).toBe("₹1,66,000");
    expect(formatCurrency(166000, resolveCurrency(undefined))).toBe("$166,000");
  });

  it("formats deterministically regardless of host locale", () => {
    expect(formatCurrency(2000, "USD")).toBe("$2,000");
    expect(formatCurrency(83000, "INR")).toBe("₹83,000");
  });

  it("formats non-finite amounts as a placeholder, never the string 'NaN'", () => {
    expect(formatCurrency(NaN, "USD")).toBe("$—");
    expect(formatCurrency(Infinity, "INR")).toBe("₹—");
  });
});

describe("migrateTrip", () => {
  const legacy = {
    id: "legacy-1",
    destination: "Goa, India",
    originAirportOrCity: "Mumbai",
    budget: 25000,
    days: [{ dayNumber: 1, theme: "Beach", spots: [], food: [] }],
    totalEstCost: 20000,
    isPublic: false,
    createdAt: "2025-01-01T00:00:00.000Z",
    // no currency, no schemaVersion
  };

  it("fills a currency and stamps the current schema version on legacy trips", () => {
    const trip = migrateTrip(legacy);
    expect(trip).not.toBeNull();
    expect(trip!.currency).toBe("USD");
    expect(trip!.schemaVersion).toBe(CURRENT_TRIP_SCHEMA_VERSION);
    expect(trip!.id).toBe("legacy-1");
  });

  it("returns null for corrupt data (non-object or missing days array)", () => {
    expect(migrateTrip(null)).toBeNull();
    expect(migrateTrip("nope")).toBeNull();
    expect(migrateTrip({ destination: "x" })).toBeNull();
    expect(migrateTrip({ destination: "x", days: "not-an-array" })).toBeNull();
  });

  it("drops malformed days and coerces bad numbers instead of crashing", () => {
    const trip = migrateTrip({
      destination: "  ",
      days: [null, { theme: "no day number" }, { dayNumber: 2, spots: "x", food: null }],
      budget: "abc",
      totalEstCost: -5,
    });
    expect(trip).not.toBeNull();
    expect(trip!.destination).toBe("Untitled trip");
    expect(trip!.days).toHaveLength(1);
    expect(trip!.days[0].dayNumber).toBe(2);
    expect(trip!.days[0].spots).toEqual([]);
    expect(trip!.days[0].food).toEqual([]);
    expect(trip!.budget).toBe(0);
    expect(trip!.totalEstCost).toBe(0);
  });

  it("preserves a valid stored currency", () => {
    expect(migrateTrip({ ...legacy, currency: "INR" })!.currency).toBe("INR");
    expect(migrateTrip({ ...legacy, currency: "KWD" })!.currency).toBe("KWD");
  });
});

describe("toTrip", () => {
  it("passes through ISO strings", () => {
    const trip = toTrip({ id: "abc" }, { ...validTrip, createdAt: "2026-01-01T00:00:00.000Z" });
    expect(trip.id).toBe("abc");
    expect(trip.createdAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("converts Firestore Timestamp-like objects", () => {
    const trip = toTrip(
      { id: "abc" },
      { ...validTrip, createdAt: { toDate: () => new Date("2026-02-01T00:00:00.000Z") } }
    );
    expect(trip.createdAt).toBe("2026-02-01T00:00:00.000Z");
  });

  it("converts seconds-based timestamps", () => {
    const trip = toTrip({ id: "abc" }, { ...validTrip, createdAt: { seconds: 0 } });
    expect(trip.createdAt).toBe(new Date(0).toISOString());
  });
});
