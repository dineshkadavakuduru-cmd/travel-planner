import { z } from "zod";
import { convertCurrency } from "./types";

export const CURRENCY_CODES = ["USD", "INR", "EUR", "GBP"] as const;
export type Currency = (typeof CURRENCY_CODES)[number];

/**
 * Budget limits are defined in USD-equivalent: 200–100,000 USD.
 * The raw `budget` field accepts a wide integer range so converted amounts
 * (e.g. ₹166,000 ≈ $2,000) pass; the object-level refine enforces the real range.
 */
const RAW_BUDGET_MIN = 1;
const RAW_BUDGET_MAX = 10000000;
const USD_BUDGET_MIN = 200;
const USD_BUDGET_MAX = 100000;

function usdBudgetRefine(val: { budget: number; currency: Currency }, ctx: z.RefinementCtx) {
  const usd = convertCurrency(Math.round(val.budget), val.currency, "USD");
  if (usd < USD_BUDGET_MIN || usd > USD_BUDGET_MAX) {
    ctx.addIssue({
      code: "custom",
      message: `Budget must equal USD ${USD_BUDGET_MIN}–${USD_BUDGET_MAX} (got ≈$${usd} for ${val.budget} ${val.currency})`,
      path: ["budget"],
    });
  }
}

export const spotSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().min(1).max(1000),
  estTimeMinutes: z.number().int().positive().max(1440),
  placeId: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
});

export const foodPickSchema = z.object({
  name: z.string().min(1).max(200),
  cuisine: z.string().min(1).max(100),
  priceTier: z.enum(["budget", "mid", "splurge"]),
  placeId: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
});

export const dayPlanSchema = z.object({
  dayNumber: z.number().int().positive().max(14),
  theme: z.string().min(1).max(200),
  spots: z.array(spotSchema).max(20),
  food: z.array(foodPickSchema).max(10),
});

export const itinerarySchema = z.object({
  days: z.array(dayPlanSchema).min(1).max(14),
  totalEstCost: z.number().nonnegative().max(1000000),
});

export const tripOptionsSchema = z.object({
  travelDates: z.object({
    start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }).optional(),
  travelers: z.number().int().min(1).max(20).optional().default(1),
  accommodationLevel: z.enum(["budget", "mid", "luxury"]).optional().default("mid"),
  travelStyle: z.enum(["relaxed", "balanced", "packed"]).optional().default("balanced"),
  transportPreference: z.enum(["public", "mixed", "private"]).optional().default("mixed"),
});

export const tripRequestSchema = z.object({
  destination: z.string().trim().min(2).max(120),
  origin: z.string().trim().max(120).optional().default(""),
  budget: z.number().int().min(RAW_BUDGET_MIN).max(RAW_BUDGET_MAX),
  days: z.number().int().min(1).max(14),
  currency: z.enum(CURRENCY_CODES).default("USD"),
  options: tripOptionsSchema.optional(),
}).superRefine(usdBudgetRefine);

export const tripSchema = z.object({
  destination: z.string().trim().min(2).max(120),
  originAirportOrCity: z.string().trim().max(120).optional().default(""),
  budget: z.number().int().min(RAW_BUDGET_MIN).max(RAW_BUDGET_MAX),
  currency: z.enum(CURRENCY_CODES).default("USD"),
  days: z.array(dayPlanSchema).min(1).max(14),
  totalEstCost: z.number().nonnegative().max(1000000),
  isPublic: z.boolean().default(false),
  enriched: z.boolean().optional().default(false),
  options: tripOptionsSchema.optional(),
}).superRefine(usdBudgetRefine);

export function sanitizeString(input: string, maxLength: number): string {
  return input
    .replace(/<[^>]*>/g, "") // Strip HTML tags
    .replace(/[<>]/g, "") // Remove any remaining angle brackets
    .trim()
    .slice(0, maxLength);
}

export function sanitizeTripData(data: unknown): z.infer<typeof tripSchema> {
  if (!data || typeof data !== "object") throw new Error("Invalid trip data: expected object");
  // Strip HTML / angle brackets from all free-text fields before validation,
  // so stored data can never carry markup into InfoWindows or JSX.
  const scrubbed = JSON.parse(JSON.stringify(data, (_key, value) =>
    typeof value === "string" ? sanitizeString(value, 2000) : value
  )) as unknown;
  const parsed = tripSchema.safeParse(scrubbed);
  if (!parsed.success) {
    throw new Error(`Invalid trip data: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`);
  }
  return parsed.data;
}
