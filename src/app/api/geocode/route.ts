import { NextResponse } from "next/server";
import { verifyIdToken } from "@/lib/auth";
import { rateLimit } from "@/lib/rateLimit";

export async function GET(request: Request) {
  const address = new URL(request.url).searchParams.get("address")?.trim();
  if (!address || address.length < 3 || address.length > 120) {
    return NextResponse.json({ error: "Enter an address between 3 and 120 characters." }, { status: 400 });
  }

  const key = (process.env.GOOGLE_GEOCODING_API_KEY || process.env.GOOGLE_PLACES_API_KEY)?.trim();
  if (!key || key.startsWith("your_")) {
    return NextResponse.json({ error: "Geocoding is not configured.", code: "not_configured", retryable: false }, { status: 503 });
  }

  const decoded = await verifyIdToken(request).catch(() => null);
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const identity = decoded ? `user:${decoded.uid}` : `ip:${ip}`;
  const limit = await rateLimit(`geocode:${identity}`, decoded ? 120 : 30, 60 * 1000);
  if (!limit.allowed) return NextResponse.json({ error: "Too many geocoding requests" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter || 60) } });

  try {
    const params = new URLSearchParams({ address, key });
    const response = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params}`, {
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(8000)]),
    });
    const data = (await response.json().catch(() => null)) as {
      status?: string;
      results?: Array<{ formatted_address?: string; geometry?: { location?: { lat: number; lng: number } } }>;
    } | null;

    if ([401, 403].includes(response.status) || data?.status === "REQUEST_DENIED" || data?.status === "OVER_DAILY_LIMIT") {
      console.error("Geocoding access or billing error:", response.status, data?.status);
      return NextResponse.json({ error: "Geocoding is unavailable.", code: "provider_configuration", retryable: false }, { status: 503 });
    }
    if (data?.status === "ZERO_RESULTS") {
      return NextResponse.json({ error: "Location not found." }, { status: 404 });
    }
    if (response.ok && data?.status === "OK") {
      const suggestions = (data.results ?? []).flatMap(({ formatted_address, geometry }) => {
        const location = geometry?.location;
        return formatted_address && formatted_address.length <= 120 && location && Number.isFinite(location.lat) && Number.isFinite(location.lng)
          ? [{ ...location, formattedAddress: formatted_address }]
          : [];
      }).slice(0, 5);
      if (suggestions.length) return NextResponse.json({ ...suggestions[0], suggestions });
    }
    console.warn("Geocoding provider failed:", response.status, data?.status);
  } catch {
    console.warn("Geocoding provider could not be reached.");
  }
  return NextResponse.json({ error: "Geocoding is temporarily unavailable.", retryable: true }, { status: 502 });
}
