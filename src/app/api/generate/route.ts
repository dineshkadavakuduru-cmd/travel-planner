import { NextResponse } from "next/server";
import OpenAI from "openai";
import { itinerarySchema, tripRequestSchema } from "@/lib/schemas";
import { rateLimit } from "@/lib/rateLimit";
import { validateEnv } from "@/lib/validateEnv";
import { verifyIdToken } from "@/lib/auth";
import type { ItineraryResponse, Trip } from "@/lib/types";

export async function POST(request: Request) {
  validateEnv();
  // Authenticated users get a per-user bucket (higher limit); anonymous falls back to IP.
  const decoded = await verifyIdToken(request).catch(() => null);
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const identity = decoded ? `user:${decoded.uid}` : `ip:${ip}`;
  const limit = await rateLimit(`generate:${identity}`, decoded ? 20 : 5, 60 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Generation limit reached. Try again later." }, { status: 429, headers: { "Retry-After": String(limit.retryAfter || 3600) } });
  }

  try {
    const parsedRequest = tripRequestSchema.safeParse(await request.json());
    if (!parsedRequest.success) {
      return NextResponse.json({ error: "Invalid trip request", details: parsedRequest.error.flatten() }, { status: 400 });
    }

    const { destination, origin, budget, days: tripDays } = parsedRequest.data;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const systemPrompt = `You are a travel itinerary planner. Given a destination, trip length, and budget, return ONLY valid JSON matching this shape:
{"days":[{"dayNumber":1,"theme":"short descriptive theme","spots":[{"name":"","description":"1-2 specific sentences","estTimeMinutes":60}],"food":[{"name":"","cuisine":"","priceTier":"budget|mid|splurge"}]}],"totalEstCost":0}
Recommend real, specific named places. Balance each day realistically, stay within budget, and output JSON only.`;

    let itinerary: ItineraryResponse | null = null;
    for (let attempt = 0; attempt < 2 && !itinerary; attempt += 1) {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Destination: ${destination}, Origin: ${origin || "Unknown"}, Budget: $${budget}, Days: ${tripDays}` },
        ],
        response_format: { type: "json_object" },
        temperature: 0.7,
      });
      const content = completion.choices[0]?.message?.content;
      if (!content) continue;
      try {
        const result = itinerarySchema.safeParse(JSON.parse(content));
        if (result.success) itinerary = result.data;
      } catch {
        // Retry once when the model returns malformed JSON.
      }
    }

    if (!itinerary) return NextResponse.json({ error: "The itinerary response was invalid. Please try again." }, { status: 502 });

    const googleApiKey = process.env.GOOGLE_PLACES_API_KEY;
    let enriched = false;
    if (googleApiKey) {
      const lookups = itinerary.days.flatMap((day) => [
        ...day.spots.map((spot) => ({ item: spot, query: `${spot.name} ${destination}` })),
        ...day.food.map((food) => ({ item: food, query: `${food.name} ${food.cuisine} ${destination}` })),
      ]);
      await Promise.allSettled(lookups.map(async ({ item, query }) => {
        const searchRes = await fetch(`https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${googleApiKey}`);
        if (!searchRes.ok) return;
        const searchData = await searchRes.json();
        const place = searchData.results?.[0];
        if (!place) return;
        item.placeId = place.place_id;
        item.lat = place.geometry?.location?.lat;
        item.lng = place.geometry?.location?.lng;
      }));
      enriched = true;
    }

    const tripResponse: Trip = {
      id: "", // Will be set on save
      ownerId: "", // Will be set on save
      destination,
      originAirportOrCity: origin,
      budget,
      currency: "USD",
      createdAt: new Date().toISOString(),
      days: itinerary.days,
      totalEstCost: itinerary.totalEstCost,
      isPublic: false,
      enriched,
    };

    return NextResponse.json(tripResponse);
  } catch (error) {
    console.error("Itinerary generation error:", error);
    return NextResponse.json({ error: "Failed to generate itinerary" }, { status: 500 });
  }
}
