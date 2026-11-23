import { NextResponse } from "next/server";
import OpenAI from "openai";
import { itinerarySchema, tripRequestSchema } from "@/lib/schemas";
import { rateLimit } from "@/lib/rateLimit";
import { validateEnv } from "@/lib/validateEnv";
import { verifyIdToken } from "@/lib/auth";
import type { ItineraryResponse, Trip } from "@/lib/types";
import { CURRENT_TRIP_SCHEMA_VERSION, convertCurrency } from "@/lib/types";

export const maxDuration = 95;

const GENERATION_TIMEOUT_MS = 75000;
const MODEL = "gpt-4o-mini";

function generationUnavailable(code: "not_configured" | "provider_configuration") {
  return NextResponse.json(
    {
      error: "Itinerary generation is unavailable. Your trip details are kept here. Come back once service is restored.",
      code,
      retryable: false,
    },
    { status: 503 }
  );
}

export async function POST(request: Request) {
  const env = validateEnv();
  if (!env.ok) return generationUnavailable("not_configured");

  try {
    const decoded = await verifyIdToken(request).catch(() => null);
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const identity = decoded ? `user:${decoded.uid}` : `ip:${ip}`;
    const limit = await rateLimit(`generate:${identity}`, decoded ? 20 : 5, 60 * 60 * 1000);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "Generation limit reached. Try again later.", code: "rate_limited", retryable: true },
        { status: 429, headers: { "Retry-After": String(limit.retryAfter || 3600) } }
      );
    }

    const parsedRequest = tripRequestSchema.safeParse(await request.json());
    if (!parsedRequest.success) {
      return NextResponse.json(
        { error: "Those trip details are not valid. Please adjust them and try again.", code: "invalid_request", retryable: false, details: parsedRequest.error.flatten() },
        { status: 400 }
      );
    }

    const { destination, origin, budget, days: tripDays, currency = "USD", options } = parsedRequest.data;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY?.trim(), maxRetries: 0 });
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(GENERATION_TIMEOUT_MS)]);

    const budgetUSD = convertCurrency(budget, currency, "USD");
    const travelDates = options?.travelDates;

    const systemPrompt = `You are a travel itinerary planner. Given a destination, trip length, budget, and preferences, return ONLY valid JSON matching this shape:
{"days":[{"dayNumber":1,"theme":"short descriptive theme","spots":[{"name":"","description":"1-2 specific sentences","estTimeMinutes":60}],"food":[{"name":"","cuisine":"","priceTier":"budget|mid|splurge"}]}],"totalEstCost":0}
Recommend real, specific named places. Return exactly the requested number of days, numbered consecutively from 1. Balance each day realistically, stay within budget, and output JSON only. Express totalEstCost as a number in USD.
Style: ${options?.travelStyle || "balanced"}. Accommodation: ${options?.accommodationLevel || "mid"}. Transport: ${options?.transportPreference || "mixed"}. Travelers: ${options?.travelers || 1}.`;

    let itinerary: ItineraryResponse | null = null;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < 2 && !itinerary && !signal.aborted; attempt += 1) {
      try {
        const completion = await openai.chat.completions.create({
          model: MODEL,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Destination: ${destination}, Origin: ${origin || "Unknown"}, Budget: ${budgetUSD} USD, Days: ${tripDays}, Travel dates: ${travelDates ? `${travelDates.start} to ${travelDates.end}` : "Flexible"}` },
          ],
          response_format: { type: "json_object" },
          temperature: 0.7,
          max_tokens: Math.max(4000, 550 * tripDays),
        }, { signal });

        const content = completion.choices[0]?.message?.content;
        if (!content) {
          lastError = new Error("Empty response from AI");
          continue;
        }

        try {
          const result = itinerarySchema.safeParse(JSON.parse(content));
          if (result.success && result.data.days.length === tripDays &&
              new Set(result.data.days.map((day) => day.dayNumber)).size === tripDays &&
              result.data.days.every((day) => day.dayNumber <= tripDays && day.spots.length > 0)) {
            itinerary = result.data;
          } else {
            lastError = new Error("Invalid itinerary format or day sequence");
          }
        } catch {
          lastError = new Error("Failed to parse AI response as JSON");
        }
      } catch (err) {
        if (err instanceof OpenAI.APIError) {
          console.error("OpenAI generation request failed:", { model: MODEL, status: err.status, code: err.code });
          if ([401, 403, 404].includes(err.status ?? 0) || err.code === "insufficient_quota" || err.code === "billing_hard_limit_reached") {
            return generationUnavailable("provider_configuration");
          }
        }
        lastError = new Error(signal.aborted ? "AI generation aborted or timed out" : "AI provider request failed");
        break;
      }
    }

    if (!itinerary) {
      // The provider failed or returned unusable data. Log the real cause and
      // return a stable, user-actionable message — never a fabricated trip.
      console.error("Itinerary generation failed:", lastError);
      return NextResponse.json(
        { error: "We couldn't build your itinerary just now. Your details are saved — please try again.", code: "generation_failed", retryable: true },
        { status: 502 }
      );
    }

    // Guarantee day ordering regardless of model output order.
    itinerary.days.sort((a, b) => a.dayNumber - b.dayNumber);

    const googleApiKey = process.env.GOOGLE_PLACES_API_KEY?.trim();
    let enriched = false;
    if (googleApiKey && !googleApiKey.startsWith("your_")) {
      const lookups = itinerary.days.flatMap((day) => [
        ...day.spots.map((spot) => ({ item: spot, query: `${spot.name} ${destination}` })),
        ...day.food.map((food) => ({ item: food, query: `${food.name} ${food.cuisine} ${destination}` })),
      ]);
      const placesSignal = AbortSignal.any([request.signal, AbortSignal.timeout(8000)]);
      const failures = new Set<string>();
      const results = await Promise.allSettled(lookups.map(async ({ item, query }) => {
        const params = new URLSearchParams({ query, key: googleApiKey });
        const response = await fetch(
          `https://maps.googleapis.com/maps/api/place/textsearch/json?${params}`,
          { signal: placesSignal }
        );
        const data = await response.json();
        if (data.status === "ZERO_RESULTS") return false;
        if (!response.ok || data.status !== "OK") {
          failures.add(`HTTP ${response.status} (${data.status ?? "unknown"})`);
          return false;
        }
        const place = data.results?.[0];
        const location = place?.geometry?.location;
        if (!place?.place_id || !Number.isFinite(location?.lat) || !Number.isFinite(location?.lng)) return false;
        item.placeId = place.place_id;
        item.lat = location.lat;
        item.lng = location.lng;
        return true;
      }));
      enriched = results.some((result) => result.status === "fulfilled" && result.value);
      if (results.some((result) => result.status === "rejected")) failures.add("Request or response failed");
      if (failures.size) console.warn("Places enrichment failed:", [...failures].join(", "));
    }

    const totalEstCost = convertCurrency(Math.round(itinerary.totalEstCost), "USD", currency);

    const tripResponse: Trip = {
      id: "",
      ownerId: "",
      destination,
      originAirportOrCity: origin,
      budget,
      currency,
      createdAt: new Date().toISOString(),
      days: itinerary.days,
      totalEstCost,
      isPublic: false,
      enriched,
      options,
      schemaVersion: CURRENT_TRIP_SCHEMA_VERSION,
    };

    return NextResponse.json(tripResponse);
  } catch (error) {
    console.error("Itinerary generation error:", error);
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: "We couldn't read those trip details. Please try again.", code: "invalid_body", retryable: false },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: "Something went wrong while building your itinerary. Please try again.", code: "generation_error", retryable: true },
      { status: 500 }
    );
  }
}
