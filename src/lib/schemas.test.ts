import { describe, expect, it } from "vitest";
import { sanitizeString, sanitizeTripData, tripRequestSchema } from "./schemas";
import { toTrip } from "./types";

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
