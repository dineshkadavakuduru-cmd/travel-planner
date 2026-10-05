import { NextResponse } from "next/server";
import OpenAI from "openai";
import { itinerarySchema, tripRequestSchema } from "@/lib/schemas";
import { rateLimit } from "@/lib/rateLimit";
import { validateEnv } from "@/lib/validateEnv";
import { verifyIdToken } from "@/lib/auth";
import type { ItineraryResponse, Trip } from "@/lib/types";
import { CURRENCIES, convertCurrency } from "@/lib/types";

const GENERATION_TIMEOUT_MS = 90000;
const ENRICHMENT_TIMEOUT_MS = 15000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function POST(request: Request) {
  validateEnv();
  const decoded = await verifyIdToken(request).catch(() => null);
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const identity = decoded ? `user:${decoded.uid}` : `ip:${ip}`;
  const limit = await rateLimit(`generate:${identity}`, decoded ? 20 : 5, 60 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Generation limit reached. Try again later." }, 
      { status: 429, headers: { "Retry-After": String(limit.retryAfter || 3600) } }
    );
  }

  try {
    const parsedRequest = tripRequestSchema.safeParse(await request.json());
    if (!parsedRequest.success) {
      return NextResponse.json(
        { error: "Invalid trip request", details: parsedRequest.error.flatten() }, 
        { status: 400 }
      );
    }

    const { destination, origin, budget, days: tripDays, currency = "USD", options } = parsedRequest.data;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: GENERATION_TIMEOUT_MS });

    const budgetUSD = convertCurrency(budget, currency, "USD");

    const systemPrompt = `You are a travel itinerary planner. Given a destination, trip length, budget, and preferences, return ONLY valid JSON matching this shape:
{"days":[{"dayNumber":1,"theme":"short descriptive theme","spots":[{"name":"","description":"1-2 specific sentences","estTimeMinutes":60}],"food":[{"name":"","cuisine":"","priceTier":"budget|mid|splurge"}]}],"totalEstCost":0}
Recommend real, specific named places. Balance each day realistically, stay within budget, and output JSON only.
Style: ${options?.travelStyle || "balanced"}. Accommodation: ${options?.accommodationLevel || "mid"}. Transport: ${options?.transportPreference || "mixed"}. Travelers: ${options?.travelers || 1}.`;

    let itinerary: ItineraryResponse | null = null;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < 2 && !itinerary; attempt += 1) {
      try {
        const completion = await withTimeout(
          openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: `Destination: ${destination}, Origin: ${origin || "Unknown"}, Budget: $${budgetUSD}, Days: ${tripDays}, Currency: ${currency}, Travelers: ${options?.travelers || 1}` },
            ],
            response_format: { type: "json_object" },
            temperature: 0.7,
            max_tokens: 4000,
          }),
          GENERATION_TIMEOUT_MS,
          "AI generation"
        );

        const content = completion.choices[0]?.message?.content;
        if (!content) {
          lastError = new Error("Empty response from AI");
          continue;
        }

        try {
          const result = itinerarySchema.safeParse(JSON.parse(content));
          if (result.success) {
            itinerary = result.data;
          } else {
            lastError = new Error(`Invalid itinerary format: ${JSON.stringify(result.error.flatten())}`);
          }
        } catch {
          lastError = new Error("Failed to parse AI response as JSON");
        }
      } catch (err) {
        lastError = err instanceof Error ? err : new Error("Unknown error");
        if (err instanceof DOMException && err.name === "AbortError") {
          lastError = new Error("AI generation timed out");
        }
      }
    }

    if (!itinerary) {
      return NextResponse.json(
        { error: lastError?.message || "The itinerary response was invalid. Please try again." },
        { status: 502 }
      );
    }

    // Guarantee day ordering regardless of model output order.
    itinerary.days = [...itinerary.days]
      .sort((a, b) => a.dayNumber - b.dayNumber)
      .slice(0, tripDays)
      .map((day, i) => ({ ...day, dayNumber: i + 1 }));

    const googleApiKey = process.env.GOOGLE_PLACES_API_KEY;
    let enriched = false;
    if (googleApiKey) {
      const lookups = itinerary.days.flatMap((day) => [
        ...day.spots.map((spot) => ({ item: spot, query: `${spot.name} ${destination}` })),
        ...day.food.map((food) => ({ item: food, query: `${food.name} ${food.cuisine} ${destination}` })),
      ]);
      try {
        await withTimeout(
          Promise.allSettled(
            lookups.map(async ({ item, query }) => {
              const ctrl = new AbortController();
              const t = setTimeout(() => ctrl.abort(), 8000);
              try {
                const searchRes = await fetch(
                  `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${googleApiKey}`,
                  { signal: ctrl.signal }
                );
                if (!searchRes.ok) return;
                const searchData = await searchRes.json();
                const place = searchData.results?.[0];
                if (!place) return;
                item.placeId = place.place_id;
                item.lat = place.geometry?.location?.lat;
                item.lng = place.geometry?.location?.lng;
              } catch {
                // Per-lookup failure must not fail generation.
              } finally {
                clearTimeout(t);
              }
            })
          ),
          ENRICHMENT_TIMEOUT_MS,
          "Place enrichment"
        );
        enriched = true;
      } catch {
        enriched = false; // Serve un-enriched itinerary rather than failing.
      }
    }

    const totalEstCost = convertCurrency(Math.round(itinerary.totalEstCost), "USD", currency);
    void CURRENCIES;

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
    };

    return NextResponse.json(tripResponse);
  } catch (error) {
    console.error("Itinerary generation error:", error);
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to generate itinerary" }, { status: 500 });
  }
}
