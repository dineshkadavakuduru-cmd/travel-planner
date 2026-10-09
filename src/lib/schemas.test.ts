import { describe, expect, it } from "vitest";
import { sanitizeString, sanitizeTripData, tripRequestSchema } from "./schemas";
import { convertCurrency, formatCurrency, resolveCurrency, toTrip } from "./types";

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
    expect(tripRequestSchema.safeParse({ destination: "Tokyo", budget: 1000, days: 3, currency: "JPY" }).success).toBe(false);
  });

  it("accepts optional trip options", () => {
    const r = tripRequestSchema.safeParse({
      destination: "Tokyo", budget: 2000, days: 5,
      options: { travelers: 2, accommodationLevel: "luxury", travelStyle: "packed", transportPreference: "private", travelDates: { start: "2026-11-01", end: "2026-11-05" } },
    });
    expect(r.success).toBe(true);
  });
});

describe("currency", () => {
  it("converts amounts between currencies (not just the symbol)", () => {
    expect(convertCurrency(100, "USD", "USD")).toBe(100);
    expect(convertCurrency(83, "INR", "USD")).toBe(1);
    expect(convertCurrency(1, "USD", "INR")).toBe(83);
    expect(convertCurrency(2000, "USD", "INR")).toBe(166000);
  });

  it("formats with the right symbol", () => {
    expect(formatCurrency(2000, "USD")).toContain("$");
    expect(formatCurrency(166000, "INR")).toContain("₹");
    expect(formatCurrency(100, "EUR")).toContain("€");
    expect(formatCurrency(100, "GBP")).toContain("£");
  });

  it("resolveCurrency falls back to USD for unknown/legacy values", () => {
    expect(resolveCurrency("INR")).toBe("INR");
    expect(resolveCurrency("USD")).toBe("USD");
    expect(resolveCurrency("JPY")).toBe("USD");
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
